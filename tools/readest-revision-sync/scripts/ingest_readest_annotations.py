#!/usr/bin/env python3
from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import urllib.parse
from dataclasses import dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any, Iterable

from readest_cross_references import markdown_reference_link, parse_cross_references


LARECHERCHE_ROOT = Path(__file__).resolve().parents[1]
WORKSPACE_ROOT = Path(os.environ["ATELIER_WORKSPACE_ROOT"]).resolve() if os.environ.get("ATELIER_WORKSPACE_ROOT") else LARECHERCHE_ROOT.parent
DEFAULT_RAG_MANIFEST = LARECHERCHE_ROOT / "output" / "rag" / "rag-ingest-manifest.jsonl"
DEFAULT_OUT_DIR = LARECHERCHE_ROOT / "output" / "readest"
DEFAULT_PACKET_DIR = LARECHERCHE_ROOT / ".atelier" / "readest-review"
KNOWN_SCHEMA_VERSION = 3
READEST_WEB_BASE = "https://web.readest.com"
READEST_APP_SCHEME = "readest://"


@dataclass(frozen=True)
class SourceMapEntry:
    work_slug: str
    title: str
    canonical_ref: str
    fragment: str
    github_owner: str
    github_repo: str
    github_ref: str
    github_path: str
    char_start: int | None
    char_end: int | None
    content: str
    content_hash: str


@dataclass(frozen=True)
class MatchResult:
    status: str
    confidence: str
    reason: str
    entry: SourceMapEntry | None = None


def load_json(path: Path) -> Any:
    try:
        return json.loads(path.read_text(encoding="utf-8"))
    except json.JSONDecodeError as error:
        raise SystemExit(f"failed to parse {path}: {error}") from error


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    if not path.exists():
        return
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                yield json.loads(stripped)
            except json.JSONDecodeError as error:
                raise SystemExit(f"failed to parse {path}:{line_number}: {error}") from error


def normalize_space(value: str) -> str:
    return re.sub(r"\s+", " ", value).strip()


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "unknown"


def sha256_text(value: str) -> str:
    return hashlib.sha256(value.encode("utf-8")).hexdigest()


def epoch_ms_to_iso(value: Any) -> str | None:
    if not isinstance(value, (int, float)):
        return None
    if value <= 0:
        return None
    seconds = value / 1000 if value > 10_000_000_000 else value
    return datetime.fromtimestamp(seconds, tz=UTC).isoformat()


def load_source_map(path: Path) -> list[SourceMapEntry]:
    entries: list[SourceMapEntry] = []
    for payload in iter_jsonl(path) or []:
        document = payload.get("document") or {}
        chunk = payload.get("chunk") or {}
        content = str(chunk.get("content") or "")
        entries.append(
            SourceMapEntry(
                work_slug=str(document.get("work_slug") or ""),
                title=str(document.get("title") or ""),
                canonical_ref=str(chunk.get("canonical_ref") or ""),
                fragment=str(chunk.get("fragment") or ""),
                github_owner=str(document.get("github_owner") or "AtelierNymphet"),
                github_repo=str(document.get("github_repo") or ""),
                github_ref=str(document.get("github_ref") or "main"),
                github_path=str(chunk.get("github_path") or document.get("github_path") or ""),
                char_start=as_int(chunk.get("char_start")),
                char_end=as_int(chunk.get("char_end")),
                content=content,
                content_hash=sha256_text(content),
            )
        )
    return [entry for entry in entries if entry.canonical_ref]


def as_int(value: Any) -> int | None:
    if isinstance(value, int):
        return value
    if isinstance(value, float):
        return int(value)
    return None


def load_readest_books(readest_dir: Path, include_deleted: bool) -> list[dict[str, Any]]:
    library_path = find_library_json(readest_dir)
    if not library_path.exists():
        raise SystemExit(f"library.json not found at {library_path}")
    readest_data_dir = library_path.parent
    library = load_json(library_path)
    raw_books = readest_library_books(library, library_path)

    books: list[dict[str, Any]] = []
    for raw_book in raw_books:
        if not isinstance(raw_book, dict):
            continue
        if raw_book.get("deletedAt") is not None and not include_deleted:
            continue
        book_hash = raw_book.get("hash")
        if not isinstance(book_hash, str) or not book_hash:
            continue
        config_path = find_book_config(readest_data_dir, book_hash)
        config = load_json(config_path) if config_path.exists() else {}
        if not isinstance(config, dict):
            config = {}
        books.append({"book": raw_book, "config": config, "config_path": config_path.as_posix()})
    return books


def readest_library_books(library: Any, library_path: Path) -> list[Any]:
    if isinstance(library, list):
        return library
    if isinstance(library, dict):
        books = library.get("books")
        if isinstance(books, list):
            return books
        legacy_books = library.get("library")
        if isinstance(legacy_books, list):
            return legacy_books
    raise SystemExit(
        f"{library_path} is not a recognized Readest library index; "
        "expected an array or an object with a books array"
    )


def find_book_config(readest_data_dir: Path, book_hash: str) -> Path:
    nested = readest_data_dir / "books" / book_hash / "config.json"
    if nested.exists():
        return nested
    return readest_data_dir / book_hash / "config.json"


def find_library_json(readest_dir: Path) -> Path:
    direct = readest_dir / "library.json"
    if direct.exists():
        return direct

    readest_nested = readest_dir / "Readest" / "library.json"
    if readest_nested.exists():
        return readest_nested

    matches = sorted(readest_dir.glob("*/library.json"))
    if len(matches) == 1:
        return matches[0]
    if len(matches) > 1:
        raise SystemExit(
            "multiple nested library.json files found under "
            f"{readest_dir}; pass the specific Readest sync directory"
        )
    return direct


def iter_annotations(books: list[dict[str, Any]], include_deleted: bool) -> Iterable[tuple[dict[str, Any], dict[str, Any], dict[str, Any]]]:
    for item in books:
        book = item["book"]
        config = item["config"]
        annotations = config.get("booknotes") or []
        if not isinstance(annotations, list):
            continue
        for annotation in annotations:
            if not isinstance(annotation, dict):
                continue
            if annotation.get("deletedAt") is not None and not include_deleted:
                continue
            yield book, config, annotation


def match_annotation(
    book: dict[str, Any],
    annotation: dict[str, Any],
    source_map: list[SourceMapEntry],
    work_slug: str | None,
) -> MatchResult:
    text = normalize_space(str(annotation.get("text") or ""))
    if not text and not normalize_space(str(annotation.get("note") or "")):
        return MatchResult("quarantine", "none", "annotation has neither text nor note")

    candidates = source_map
    if work_slug:
        candidates = [entry for entry in candidates if entry.work_slug == work_slug]
    else:
        title_slug = slugify(str(book.get("title") or ""))
        title_words = set(title_slug.split("-"))
        if title_words:
            title_candidates = [
                entry for entry in candidates
                if entry.work_slug in title_words or title_slug in slugify(entry.title)
            ]
            if title_candidates:
                candidates = title_candidates

    if text:
        exact = [entry for entry in candidates if text in normalize_space(entry.content)]
        if len(exact) == 1:
            return MatchResult("mapped", "high", "highlight text matched one source-map chunk", exact[0])
        if len(exact) > 1:
            best = sorted(exact, key=lambda entry: len(entry.content))[0]
            return MatchResult("mapped", "medium", f"highlight text matched {len(exact)} chunks; chose shortest", best)

    cfi = str(annotation.get("cfi") or "")
    if cfi:
        return MatchResult("quarantine", "none", "no source-map text match; CFI retained for manual anchor mapping")

    return MatchResult("quarantine", "none", "no source-map text match")


def normalized_record(
    book: dict[str, Any],
    config: dict[str, Any],
    annotation: dict[str, Any],
    match: MatchResult,
) -> dict[str, Any]:
    entry = match.entry
    highlight_text = normalize_space(str(annotation.get("text") or ""))
    note = str(annotation.get("note") or "").strip()
    cross_references = parse_cross_references(f"{note} {highlight_text}")
    book_hash = str(book.get("hash") or annotation.get("bookHash") or "")
    annotation_id = str(annotation.get("id") or sha256_text(json.dumps(annotation, sort_keys=True))[:16])
    cfi = str(annotation.get("cfi") or None)
    web_url, app_url, book_url = _build_readest_annotation_urls(book_hash, annotation_id, cfi if cfi else None)

    record: dict[str, Any] = {
        "status": match.status,
        "match_confidence": match.confidence,
        "match_reason": match.reason,
        "readest": {
            "book_hash": book_hash,
            "annotation_id": annotation_id,
            "book_title": book.get("title"),
            "book_author": book.get("author"),
            "book_format": book.get("format"),
            "schema_version": config.get("schemaVersion"),
            "type": annotation.get("type"),
            "style": annotation.get("style"),
            "color": annotation.get("color"),
            "page": annotation.get("page"),
            "cfi": annotation.get("cfi"),
            "annotation_url": web_url,
            "annotation_app_url": app_url,
            "book_url": book_url,
            "created_at": epoch_ms_to_iso(annotation.get("createdAt")),
            "updated_at": epoch_ms_to_iso(annotation.get("updatedAt")),
        },
        "highlight_text": highlight_text,
        "reader_note": note,
        "cross_references": cross_references,
        "highlight_hash": sha256_text(f"{book_hash}:{annotation_id}:{highlight_text}:{note}"),
    }

    if entry:
        record["work_slug"] = entry.work_slug
        record["canonical_ref"] = entry.canonical_ref
        record["fragment"] = entry.fragment
        record["source_repo"] = entry.github_repo
        record["source_path"] = entry.github_path
        record["source_ref"] = entry.github_ref
        record["source_owner"] = entry.github_owner
        record["source_char_start"] = entry.char_start
        record["source_char_end"] = entry.char_end
        record["source_hash"] = entry.content_hash
    return record


def _build_readest_annotation_urls(book_hash: str, annotation_id: str, cfi: str | None) -> tuple[str, str, str]:
    safe_book_hash = urllib.parse.quote(book_hash, safe="")
    safe_annotation_id = urllib.parse.quote(annotation_id, safe="")
    encoded_cfi = urllib.parse.quote(str(cfi), safe="") if cfi else ""

    web_base = f"{READEST_WEB_BASE}/o/book/{safe_book_hash}/annotation/{safe_annotation_id}"
    app_base = f"{READEST_APP_SCHEME}book/{safe_book_hash}/annotation/{safe_annotation_id}"
    web_url = f"{web_base}?cfi={encoded_cfi}" if encoded_cfi else web_base
    app_url = f"{app_base}?cfi={encoded_cfi}" if encoded_cfi else app_base
    book_url = f"{READEST_WEB_BASE}/o/book/{safe_book_hash}"
    return web_url, app_url, book_url


def write_jsonl(path: Path, records: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", encoding="utf-8") as handle:
        for record in records:
            handle.write(json.dumps(record, ensure_ascii=False, sort_keys=True) + "\n")


def source_context(record: dict[str, Any], radius: int) -> str:
    repo = record.get("source_repo")
    source_path = record.get("source_path")
    start = record.get("source_char_start")
    end = record.get("source_char_end")
    if not isinstance(repo, str) or not repo or not isinstance(source_path, str):
        return ""
    path = Path.cwd() / source_path
    if not path.exists():
        path = WORKSPACE_ROOT / repo / source_path
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf-8", errors="replace")
    if not isinstance(start, int) or not isinstance(end, int):
        return text[: radius * 2].strip()
    window_start = max(0, start - radius)
    window_end = min(len(text), end + radius)
    return text[window_start:window_end].strip()


def write_review_packets(records: list[dict[str, Any]], packet_dir: Path, context_radius: int) -> int:
    mapped = [record for record in records if record.get("status") == "mapped"]
    written = 0
    for record in mapped:
        work_slug = str(record.get("work_slug") or "unknown")
        annotation_id = str(record.get("readest", {}).get("annotation_id") or record["highlight_hash"][:12])
        fragment = str(record.get("fragment") or "").replace("#", "")
        name = f"{slugify(fragment or annotation_id)}-{record['highlight_hash'][:12]}.md"
        out_path = packet_dir / work_slug / name
        out_path.parent.mkdir(parents=True, exist_ok=True)
        context = source_context(record, context_radius)
        body = render_review_packet(record, context)
        out_path.write_text(body, encoding="utf-8")
        written += 1
    return written


def render_review_packet(record: dict[str, Any], context: str) -> str:
    readest = record.get("readest", {})
    lines = [
        "---",
        f"work_slug: {record.get('work_slug', '')}",
        f"canonical_ref: {record.get('canonical_ref', '')}",
        f"source_repo: {record.get('source_repo', '')}",
        f"source_path: {record.get('source_path', '')}",
        f"source_ref: {record.get('source_ref', '')}",
        f"source_hash: {record.get('source_hash', '')}",
        f"readest_book_hash: {readest.get('book_hash', '')}",
        f"readest_annotation_id: {readest.get('annotation_id', '')}",
        f"match_confidence: {record.get('match_confidence', '')}",
        "status: review",
        "---",
        "",
        "# Readest Revision Review",
        "",
        "## Reader Highlight",
        "",
        blockquote(str(record.get("highlight_text") or "")),
        "",
        "## Reader Note",
        "",
        str(record.get("reader_note") or "_No note._"),
        "",
        "## Cross-References",
        "",
        render_cross_references(record.get("cross_references")),
        "",
        "## Source Context",
        "",
        "```text",
        context,
        "```",
        "",
        "## AI Review Prompt",
        "",
        "Review the highlight and reader note against the source context. Propose a source edit only if the note identifies a concrete revision need. Preserve canonical meaning, do not invent source facts, and return a patch against the source file when possible.",
        "",
        "## Proposed Patch",
        "",
        "_Pending._",
        "",
    ]
    return "\n".join(lines)


def render_cross_references(cross_references: Any) -> str:
    if not isinstance(cross_references, list) or not cross_references:
        return "_No explicit cross-references._"
    return "\n".join(
        markdown_reference_link(reference)
        for reference in cross_references
        if isinstance(reference, dict)
    )


def blockquote(value: str) -> str:
    if not value:
        return "_No highlighted text._"
    return "\n".join(f"> {line}" if line else ">" for line in value.splitlines())


def main() -> int:
    parser = argparse.ArgumentParser(description="Ingest Readest annotations into Atelier canonical review records.")
    parser.add_argument("readest_dir", type=Path, help="Path to the Readest Books/WebDAV sync folder containing library.json.")
    parser.add_argument("--source-map", type=Path, default=DEFAULT_RAG_MANIFEST, help="JSONL source map. Defaults to the RAG ingest manifest.")
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--packet-dir", type=Path, default=DEFAULT_PACKET_DIR)
    parser.add_argument("--work-slug", help="Restrict mapping to one canonical work slug.")
    parser.add_argument("--include-deleted", action="store_true")
    parser.add_argument("--no-review-packets", action="store_true")
    parser.add_argument("--context-radius", type=int, default=1600)
    args = parser.parse_args()

    source_map = load_source_map(args.source_map)
    books = load_readest_books(args.readest_dir, args.include_deleted)

    records: list[dict[str, Any]] = []
    newer_schema_versions: set[int] = set()
    for book, config, annotation in iter_annotations(books, args.include_deleted):
        schema_version = config.get("schemaVersion")
        if isinstance(schema_version, int) and schema_version > KNOWN_SCHEMA_VERSION:
            newer_schema_versions.add(schema_version)
        match = match_annotation(book, annotation, source_map, args.work_slug)
        records.append(normalized_record(book, config, annotation, match))

    mapped = [record for record in records if record["status"] == "mapped"]
    quarantine = [record for record in records if record["status"] != "mapped"]

    write_jsonl(args.out_dir / "readest-annotations.normalized.jsonl", records)
    write_jsonl(args.out_dir / "readest-annotations.mapped.jsonl", mapped)
    write_jsonl(args.out_dir / "readest-annotations.quarantine.jsonl", quarantine)

    packets = 0
    if not args.no_review_packets:
        packets = write_review_packets(mapped, args.packet_dir, args.context_radius)

    summary = {
        "books": len(books),
        "annotations": len(records),
        "mapped": len(mapped),
        "quarantine": len(quarantine),
        "review_packets": packets,
        "source_map_entries": len(source_map),
        "newer_schema_versions": sorted(newer_schema_versions),
        "outputs": {
            "normalized": (args.out_dir / "readest-annotations.normalized.jsonl").as_posix(),
            "mapped": (args.out_dir / "readest-annotations.mapped.jsonl").as_posix(),
            "quarantine": (args.out_dir / "readest-annotations.quarantine.jsonl").as_posix(),
            "review_packets": args.packet_dir.as_posix(),
        },
    }
    (args.out_dir / "readest-annotations.summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
