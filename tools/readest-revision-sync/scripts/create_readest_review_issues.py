#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import subprocess
import textwrap
import urllib.error
import urllib.parse
import urllib.request
from pathlib import Path
from typing import Any

from readest_cross_references import (
    markdown_reference_link,
    parse_cross_references,
    references_as_prompt_payload,
)


DEFAULT_INPUT = Path("output/readest/readest-annotations.mapped.jsonl")


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    records: list[dict[str, Any]] = []
    if not path.exists():
        raise SystemExit(f"input not found: {path}")
    with path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if line.strip():
                records.append(json.loads(line))
    return records


def issue_key(record: dict[str, Any]) -> str:
    readest = record.get("readest") or {}
    return f"readest:{readest.get('book_hash')}:{readest.get('annotation_id')}:{record.get('highlight_hash')}"


def existing_issue_keys() -> set[str]:
    result = subprocess.run(
        ["gh", "issue", "list", "--state", "all", "--label", "readest-review", "--limit", "200", "--json", "body"],
        text=True,
        capture_output=True,
        check=False,
    )
    if result.returncode != 0:
        raise SystemExit(result.stderr.strip() or result.stdout.strip())
    issues = json.loads(result.stdout or "[]")
    keys: set[str] = set()
    for issue in issues:
        body = issue.get("body") or ""
        marker = "<!-- readest-review-key:"
        if marker in body:
            keys.add(body.split(marker, 1)[1].split("-->", 1)[0].strip())
    return keys


def gemini_summary(record: dict[str, Any], model: str) -> dict[str, str]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return {
            "title": fallback_title(record),
            "summary": "GEMINI_API_KEY was not set; issue created with raw Readest context only.",
            "proposed_next_step": "Review the source context and reader note manually.",
        }

    readest = record.get("readest") or {}

    prompt = {
        "task": "Summarize a Readest highlight/note as a GitHub issue for manuscript revision.",
        "rules": [
            "Do not invent source facts.",
            "Keep the title under 80 characters.",
            "Focus on the concrete edit or review need.",
            "If the note is vague, say manual review is needed.",
        ],
        "record": {
            "work_slug": record.get("work_slug"),
            "canonical_ref": record.get("canonical_ref"),
            "readest_annotation_url": readest.get("annotation_url"),
            "readest_book_url": readest.get("book_url"),
            "source_repo": record.get("source_repo"),
            "source_path": record.get("source_path"),
            "highlight_text": record.get("highlight_text"),
            "reader_note": record.get("reader_note"),
            "match_confidence": record.get("match_confidence"),
            "cross_references": references_as_prompt_payload(record_cross_references(record)),
        },
    }
    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "title": {"type": "string"},
            "summary": {"type": "string"},
            "proposed_next_step": {"type": "string"},
        },
        "required": ["title", "summary", "proposed_next_step"],
    }
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [
                    {
                        "text": json.dumps(prompt, ensure_ascii=False),
                    }
                ],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        },
    }

    encoded_model = model if model.startswith("models/") else f"models/{model}"
    req = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/{encoded_model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Gemini request failed: HTTP {error.code}\n{detail}") from error

    text = extract_gemini_text(body)
    return json.loads(text)


def extract_gemini_text(body: dict[str, Any]) -> str:
    chunks: list[str] = []
    for candidate in body.get("candidates") or []:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if part.get("text"):
                chunks.append(part["text"])
    if not chunks:
        raise SystemExit(f"Gemini response did not include output text: {json.dumps(body)[:1000]}")
    return "".join(chunks)


def fallback_title(record: dict[str, Any]) -> str:
    work = record.get("work_slug") or "readest"
    note = (record.get("reader_note") or record.get("highlight_text") or "review annotation").strip()
    note = " ".join(note.split())
    return f"Readest review: {work}: {note[:48]}"


def record_cross_references(record: dict[str, Any]) -> list[dict[str, Any]]:
    references = record.get("cross_references")
    if isinstance(references, list):
        return [reference for reference in references if isinstance(reference, dict)]
    return parse_cross_references(
        " ".join(
            [
                str(record.get("reader_note") or ""),
                str(record.get("highlight_text") or ""),
            ]
        )
    )


def canonical_nav_links(canonical_ref: str | None) -> list[tuple[str, str]]:
    """Build stable reader/app links for this canonical annotation context."""
    if not canonical_ref:
        return []

    try:
        parsed = urllib.parse.urlparse(canonical_ref)
    except ValueError:
        return []

    base = parsed.scheme and parsed.netloc and f"{parsed.scheme}://{parsed.netloc}" or "https://ateliernymphet.com"
    path_parts = [segment for segment in parsed.path.split("/") if segment]
    if not path_parts:
        return []

    links: list[tuple[str, str]] = []
    canonical_base = canonical_base_without_anchor(canonical_ref).split("#", 1)[0]
    links.append(("Open canonical source", canonical_base))

    if path_parts[0] != "larecherche":
        return links

    if len(path_parts) >= 2:
        work_slug = path_parts[1]
        work_url = f"{base}/larecherche/{work_slug}/"
        links.append(("Open La Recherche work", work_url))
        links.append(("Open Twenty Dollar Words for this work", f"{base}/larecherche/{work_slug}/twenty-dollar-words/"))

        if len(path_parts) >= 3 and path_parts[2] == "twenty-dollar-words":
            tdw_base = f"{base}/larecherche/{work_slug}/twenty-dollar-words/"
            links[-1] = ("Open Twenty Dollar Words lane index", tdw_base)
            if len(path_parts) >= 4:
                source_slug = path_parts[3]
                source_url = f"{tdw_base}{source_slug}/"
                links.append(("Open Twenty Dollar Words source", source_url))

    return links


def canonical_base_without_anchor(canonical_ref: str | None) -> str:
    if not canonical_ref:
        return ""
    return canonical_ref.split("#", 1)[0]


def issue_body(record: dict[str, Any], summary: dict[str, str], key: str) -> str:
    readest = record.get("readest") or {}
    canonical_ref = record.get("canonical_ref")
    readest_links = [
        ("Readest web deep link", readest.get("annotation_url", "_")),
        ("Readest app deep link", readest.get("annotation_app_url", "_")),
        ("Readest book", readest.get("book_url", "_")),
    ]
    nav_links = canonical_nav_links(canonical_ref)

    readest_block = []
    for label, link in readest_links:
        if link and link != "_":
            readest_block.append(f"- {label}: [{link}]({link})")

    source_links = []
    for label, link in nav_links:
        if link:
            source_links.append(f"- {label}: [{link}]({link})")

    cross_references = record_cross_references(record)
    reference_links_block = (
        "\n".join(markdown_reference_link(reference) for reference in cross_references)
        if cross_references
        else "- _No explicit external references found in this note."
    )

    readest_links_block = "\n".join(readest_block) if readest_block else "- _Not available."
    source_links_block = "\n".join(source_links) if source_links else "- _Not available."

    return textwrap.dedent(f"""\
    <!-- readest-review-key: {key} -->
    ## AI Summary

    {summary["summary"]}

    ## Proposed Next Step

    {summary["proposed_next_step"]}

    ## Reader Highlight

    > {record.get("highlight_text") or "_No highlighted text._"}

    ## Reader Note

    {record.get("reader_note") or "_No reader note._"}

    ## Canonical Source

    - Canonical ref: `{record.get("canonical_ref")}`
    - Source repo: `{record.get("source_repo")}`
    - Source path: `{record.get("source_path")}`
    - Source ref: `{record.get("source_ref")}`
    - Match confidence: `{record.get("match_confidence")}`
    - Readest book hash: `{readest.get("book_hash")}`
    - Readest annotation id: `{readest.get("annotation_id")}`
    - Readest CFI: `{record.get("readest", {}).get("cfi")}`

    ## Readest Deep Links

{readest_links_block}

    ## Canonical Navigation

{source_links_block}

    ## Footnote/Endnote Cross-References

{reference_links_block}

    ## Review Rule

    Apply accepted changes to the source repository, then rebuild and resync the EPUB. Do not edit the EPUB artifact as source.
    """)


def create_issue(title: str, body: str, labels: list[str], dry_run: bool) -> None:
    print(f"issue: {title}")
    if dry_run:
        print(body[:1200])
        return
    for label in labels:
        subprocess.run(
            ["gh", "label", "create", label, "--force", "--color", "8250df"],
            text=True,
            capture_output=True,
            check=False,
        )
    command = ["gh", "issue", "create", "--title", title, "--body", body]
    for label in labels:
        command.extend(["--label", label])
    subprocess.run(command, check=True)


def main() -> int:
    parser = argparse.ArgumentParser(description="Create GitHub issues from mapped Readest annotations.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--model", default=os.environ.get("GEMINI_MODEL", "gemini-3.5-flash"))
    parser.add_argument("--limit", type=int, default=int(os.environ.get("READEST_ISSUE_LIMIT", "20")))
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    labels = ["readest-review", "ai-review"]
    records = load_jsonl(args.input)
    seen = existing_issue_keys() if not args.dry_run else set()
    created = 0
    for record in records:
        if created >= args.limit:
            break
        key = issue_key(record)
        if key in seen:
            continue
        summary = gemini_summary(record, args.model)
        create_issue(summary["title"], issue_body(record, summary, key), labels, args.dry_run)
        created += 1
    print(f"created_or_planned={created}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
