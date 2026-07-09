#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import os
import textwrap
import urllib.error
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Any


DEFAULT_INPUT = Path("output/readest/readest-annotations.mapped.jsonl")
DEFAULT_OUT_DIR = Path(".atelier/readest-edit-proposals")


@dataclass(frozen=True)
class SourceContext:
    path: Path | None
    text: str
    window_start: int | None
    window_end: int | None


def iter_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"input not found: {path}")
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                records.append(json.loads(stripped))
            except json.JSONDecodeError as error:
                raise SystemExit(f"failed to parse {path}:{line_number}: {error}") from error
    return records


def slug(value: str) -> str:
    out = "".join(ch.lower() if ch.isalnum() else "-" for ch in value).strip("-")
    while "--" in out:
        out = out.replace("--", "-")
    return out[:96] or "proposal"


def proposal_key(record: dict[str, Any]) -> str:
    readest = record.get("readest") or {}
    return ":".join(
        [
            "readest-edit",
            str(readest.get("book_hash") or "book"),
            str(readest.get("annotation_id") or "annotation"),
            str(record.get("highlight_hash") or "hash"),
        ]
    )


def resolve_source_path(record: dict[str, Any], workspace_root: Path) -> Path | None:
    source_path = record.get("source_path")
    if not isinstance(source_path, str) or not source_path:
        return None

    direct = Path(source_path)
    if direct.exists():
        return direct.resolve()

    repo = record.get("source_repo")
    if isinstance(repo, str) and repo:
        candidate = workspace_root / repo / source_path
        if candidate.exists():
            return candidate.resolve()

    candidate = workspace_root / source_path
    if candidate.exists():
        return candidate.resolve()
    return None


def source_context(record: dict[str, Any], workspace_root: Path, radius: int) -> SourceContext:
    path = resolve_source_path(record, workspace_root)
    if path is None:
        return SourceContext(path=None, text="", window_start=None, window_end=None)

    text = path.read_text(encoding="utf-8", errors="replace")
    start = record.get("source_char_start")
    end = record.get("source_char_end")
    if not isinstance(start, int) or not isinstance(end, int) or start < 0 or end < start:
        return SourceContext(path=path, text=text[: radius * 2].strip(), window_start=0, window_end=min(len(text), radius * 2))

    window_start = max(0, start - radius)
    window_end = min(len(text), end + radius)
    return SourceContext(path=path, text=text[window_start:window_end].strip(), window_start=window_start, window_end=window_end)


def proposal_prompt(record: dict[str, Any], context: SourceContext) -> dict[str, Any]:
    readest = record.get("readest") or {}
    return {
        "task": "Propose a source edit from a Readest annotation.",
        "rules": [
            "Do not apply the edit.",
            "Do not invent facts not present in the source context or annotation.",
            "Return a unified diff only when the requested edit is concrete.",
            "If the note is vague or requires human judgment, mark it needs_manual_review.",
            "Preserve the author's style unless the reader note explicitly requests otherwise.",
        ],
        "source": {
            "repo": record.get("source_repo"),
            "path": record.get("source_path"),
            "ref": record.get("source_ref"),
            "char_start": record.get("source_char_start"),
            "char_end": record.get("source_char_end"),
            "context_window_start": context.window_start,
            "context_window_end": context.window_end,
            "context": context.text,
        },
        "annotation": {
            "work_slug": record.get("work_slug"),
            "canonical_ref": record.get("canonical_ref"),
            "highlight_text": record.get("highlight_text"),
            "reader_note": record.get("reader_note"),
            "cross_references": record.get("cross_references") or [],
            "readest_annotation_url": readest.get("annotation_url"),
            "readest_app_url": readest.get("annotation_app_url"),
        },
    }


def fallback_proposal(record: dict[str, Any], context: SourceContext, reason: str) -> dict[str, Any]:
    return {
        "status": "needs_manual_review",
        "rationale": reason,
        "unified_diff": "",
        "edited_excerpt": "",
        "prompt": proposal_prompt(record, context),
    }


def gemini_proposal(record: dict[str, Any], context: SourceContext, model: str) -> dict[str, Any]:
    api_key = os.environ.get("GEMINI_API_KEY")
    if not api_key:
        return fallback_proposal(record, context, "GEMINI_API_KEY was not set; no AI edit proposal generated.")

    schema = {
        "type": "object",
        "additionalProperties": False,
        "properties": {
            "status": {"type": "string", "enum": ["proposed", "needs_manual_review"]},
            "rationale": {"type": "string"},
            "unified_diff": {"type": "string"},
            "edited_excerpt": {"type": "string"},
        },
        "required": ["status", "rationale", "unified_diff", "edited_excerpt"],
    }
    payload = {
        "contents": [
            {
                "role": "user",
                "parts": [{"text": json.dumps(proposal_prompt(record, context), ensure_ascii=False)}],
            }
        ],
        "generationConfig": {
            "responseMimeType": "application/json",
            "responseJsonSchema": schema,
        },
    }
    encoded_model = model if model.startswith("models/") else f"models/{model}"
    request = urllib.request.Request(
        f"https://generativelanguage.googleapis.com/v1beta/{encoded_model}:generateContent",
        data=json.dumps(payload).encode("utf-8"),
        headers={
            "x-goog-api-key": api_key,
            "Content-Type": "application/json",
        },
        method="POST",
    )
    try:
        with urllib.request.urlopen(request, timeout=120) as response:
            body = json.loads(response.read().decode("utf-8"))
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"Gemini request failed: HTTP {error.code}\n{detail}") from error

    chunks: list[str] = []
    for candidate in body.get("candidates") or []:
        content = candidate.get("content") or {}
        for part in content.get("parts") or []:
            if part.get("text"):
                chunks.append(part["text"])
    if not chunks:
        raise SystemExit(f"Gemini response did not include output text: {json.dumps(body)[:1000]}")
    return json.loads("".join(chunks))


def render_markdown(record: dict[str, Any], context: SourceContext, proposal: dict[str, Any], key: str) -> str:
    readest = record.get("readest") or {}
    source_path = record.get("source_path") or ""
    context_path = context.path.as_posix() if context.path else "_source file not found_"
    diff = proposal.get("unified_diff") or "_No patch proposed._"
    return textwrap.dedent(
        f"""\
        <!-- readest-edit-key: {key} -->
        # Readest Source Edit Proposal

        ## Status

        {proposal.get("status", "needs_manual_review")}

        ## Rationale

        {proposal.get("rationale", "")}

        ## Source

        - Repository: `{record.get("source_owner", "")}/{record.get("source_repo", "")}`
        - Path: `{source_path}`
        - Resolved local path: `{context_path}`
        - Ref: `{record.get("source_ref", "")}`
        - Canonical reference: {record.get("canonical_ref", "")}

        ## Readest

        - Book: {readest.get("book_title", "")}
        - Annotation: {readest.get("annotation_id", "")}
        - Web: {readest.get("annotation_url", "")}
        - App: {readest.get("annotation_app_url", "")}

        ## Reader Highlight

        {blockquote(str(record.get("highlight_text") or ""))}

        ## Reader Note

        {record.get("reader_note") or "_No note._"}

        ## Proposed Patch

        ```diff
        {diff}
        ```

        ## Edited Excerpt

        ```text
        {proposal.get("edited_excerpt") or ""}
        ```

        ## Source Context

        ```text
        {context.text}
        ```
        """
    )


def blockquote(value: str) -> str:
    if not value:
        return "_No highlighted text._"
    return "\n".join(f"> {line}" if line else ">" for line in value.splitlines())


def write_outputs(records: list[dict[str, Any]], out_dir: Path, proposals: list[dict[str, Any]]) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    jsonl_path = out_dir / "readest-source-edit-proposals.jsonl"
    with jsonl_path.open("w", encoding="utf-8") as handle:
        for proposal in proposals:
            handle.write(json.dumps(proposal, ensure_ascii=False, sort_keys=True) + "\n")

    summary = {
        "records": len(records),
        "proposals": len(proposals),
        "proposed": sum(1 for proposal in proposals if proposal.get("proposal", {}).get("status") == "proposed"),
        "needs_manual_review": sum(1 for proposal in proposals if proposal.get("proposal", {}).get("status") != "proposed"),
        "jsonl": jsonl_path.as_posix(),
    }
    (out_dir / "readest-source-edit-proposals.summary.json").write_text(
        json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(json.dumps(summary, ensure_ascii=False, indent=2, sort_keys=True))


def main() -> int:
    parser = argparse.ArgumentParser(description="Generate source-edit proposals from mapped Readest annotations.")
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--out-dir", type=Path, default=DEFAULT_OUT_DIR)
    parser.add_argument("--workspace-root", type=Path, default=Path.cwd().parent)
    parser.add_argument("--context-radius", type=int, default=1600)
    parser.add_argument("--limit", type=int, default=0, help="Maximum records to process; 0 means all.")
    parser.add_argument("--no-ai", action="store_true", help="Write manual-review proposal prompts without calling Gemini.")
    parser.add_argument("--model", default=os.environ.get("GEMINI_READEST_EDIT_MODEL", "gemini-3.5-flash"))
    args = parser.parse_args()

    records = iter_jsonl(args.input)
    if args.limit > 0:
        records = records[: args.limit]

    proposals: list[dict[str, Any]] = []
    for record in records:
        key = proposal_key(record)
        context = source_context(record, args.workspace_root.resolve(), args.context_radius)
        if context.path is None:
            proposal = fallback_proposal(record, context, "Source file could not be resolved locally.")
        elif args.no_ai:
            proposal = fallback_proposal(record, context, "AI proposal generation disabled with --no-ai.")
        else:
            proposal = gemini_proposal(record, context, args.model)

        work_slug = str(record.get("work_slug") or "unknown")
        annotation_id = str((record.get("readest") or {}).get("annotation_id") or record.get("highlight_hash") or "annotation")
        markdown_path = args.out_dir / work_slug / f"{slug(annotation_id)}-{slug(str(record.get('highlight_hash') or key))[:12]}.md"
        markdown_path.parent.mkdir(parents=True, exist_ok=True)
        markdown_path.write_text(render_markdown(record, context, proposal, key), encoding="utf-8")

        proposals.append(
            {
                "key": key,
                "proposal_path": markdown_path.as_posix(),
                "source_owner": record.get("source_owner"),
                "source_path": record.get("source_path"),
                "source_repo": record.get("source_repo"),
                "readest": record.get("readest") or {},
                "proposal": proposal,
            }
        )

    write_outputs(records, args.out_dir, proposals)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
