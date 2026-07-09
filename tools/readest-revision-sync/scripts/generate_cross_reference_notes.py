#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import re
from collections import defaultdict
from pathlib import Path
from typing import Any, Iterable

from readest_cross_references import markdown_reference_link


DEFAULT_INPUT = Path("output/readest/readest-annotations.mapped.jsonl")
DEFAULT_OUT_DIR = Path(".atelier/readest-cross-reference-notes")
CROSS_REFERENCE_NOTE_SCHEMA = "scriptorium.cross-reference-notes.v1"


def iter_jsonl(path: Path) -> Iterable[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"input not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                payload = json.loads(stripped)
            except json.JSONDecodeError as error:
                raise SystemExit(f"failed to parse {path}:{line_number}: {error}") from error
            if isinstance(payload, dict):
                yield payload


def slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug or "unknown"


def note_id(record: dict[str, Any], index: int) -> str:
    readest = record.get("readest") or {}
    annotation_id = slugify(str(readest.get("annotation_id") or "annotation"))
    highlight_hash = slugify(str(record.get("highlight_hash") or ""))[:12]
    return f"sr-xref-{index:04d}-{annotation_id}-{highlight_hash}".rstrip("-")


def has_cross_references(record: dict[str, Any]) -> bool:
    references = record.get("cross_references")
    return isinstance(references, list) and any(isinstance(item, dict) for item in references)


def grouped_records(records: Iterable[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, list[dict[str, Any]]] = defaultdict(list)
    for record in records:
        if not has_cross_references(record):
            continue
        work_slug = slugify(str(record.get("work_slug") or "unknown"))
        grouped[work_slug].append(record)
    return dict(grouped)


def render_note(record: dict[str, Any], index: int) -> str:
    readest = record.get("readest") or {}
    source_link = record.get("source_link") if isinstance(record.get("source_link"), dict) else {}
    references = [
        markdown_reference_link(reference)
        for reference in record.get("cross_references", [])
        if isinstance(reference, dict)
    ]
    if not references:
        references = ["_No explicit cross-references._"]

    source_url = str(source_link.get("github_url") or "")
    source_line = f"- Source: [{record.get('source_path', '')}]({source_url})" if source_url else f"- Source: `{record.get('source_path', '')}`"
    canonical_ref = str(record.get("canonical_ref") or "")
    reader_note = str(record.get("reader_note") or "_No reader note._")
    highlight_text = str(record.get("highlight_text") or "_No highlighted text._")

    return "\n".join(
        [
            f'<section id="{note_id(record, index)}" class="scriptorium-cross-reference-note">',
            "",
            f"### Cross-reference note {index}",
            "",
            f"- Schema: `{CROSS_REFERENCE_NOTE_SCHEMA}`",
            f"- Work: `{record.get('work_slug', 'unknown')}`",
            f"- Canonical reference: {canonical_ref}",
            source_line,
            f"- Readest web: {readest.get('annotation_url', '')}",
            f"- Readest app: {readest.get('annotation_app_url', '')}",
            f"- Marginalia layer: `{record.get('marginalia_layer', 'personal')}`",
            "",
            "Reader highlight:",
            "",
            blockquote(highlight_text),
            "",
            "Reader note:",
            "",
            reader_note,
            "",
            "References:",
            "",
            *references,
            "",
            "</section>",
        ]
    )


def render_work_notes(work_slug: str, records: list[dict[str, Any]]) -> str:
    title = work_slug.replace("-", " ").title()
    sorted_records = sorted(
        records,
        key=lambda record: (
            str(record.get("canonical_ref") or ""),
            str((record.get("readest") or {}).get("annotation_id") or ""),
        ),
    )
    lines = [
        "---",
        f"schema: {CROSS_REFERENCE_NOTE_SCHEMA}",
        f"work_slug: {work_slug}",
        f"note_count: {len(sorted_records)}",
        "---",
        "",
        f"# {title} Cross-Reference Endnotes",
        "",
        "Generated from mapped Readest annotations. Include this file as an EPUB endnotes appendix or split its sections into per-chapter notes during the source build.",
        "",
    ]
    for index, record in enumerate(sorted_records, start=1):
        lines.append(render_note(record, index))
        lines.append("")
    return "\n".join(lines).rstrip() + "\n"


def write_notes(records: list[dict[str, Any]], out_dir: Path) -> list[Path]:
    out_dir.mkdir(parents=True, exist_ok=True)
    written: list[Path] = []
    for work_slug, work_records in sorted(grouped_records(records).items()):
        out_path = out_dir / f"{work_slug}.cross-reference-endnotes.md"
        out_path.write_text(render_work_notes(work_slug, work_records), encoding="utf-8")
        written.append(out_path)
    summary = {
        "schema": CROSS_REFERENCE_NOTE_SCHEMA,
        "input_records": len(records),
        "work_count": len(written),
        "outputs": [path.as_posix() for path in written],
    }
    (out_dir / "summary.json").write_text(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return written


def blockquote(value: str) -> str:
    if not value:
        return "_No highlighted text._"
    return "\n".join(f"> {line}" if line else ">" for line in value.splitlines())


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate Markdown cross-reference endnotes from mapped Readest annotations.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    args = parser.parse_args()

    records = list(iter_jsonl(args.input))
    written = write_notes(records, args.out_dir)
    print(json.dumps({"generated": len(written), "out_dir": args.out_dir.as_posix()}, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
