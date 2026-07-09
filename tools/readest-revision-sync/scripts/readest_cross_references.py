from __future__ import annotations

import re
from typing import Any


DATETIME_STAMP_RE = re.compile(
    r"\b(?P<scheme>[a-z][a-z0-9+.-]*):"
    r"(?P<namespace>[A-Za-z0-9][A-Za-z0-9_.-]*):"
    r"(?P<stamp>\d{4}\.\d{2}\.\d{2}\.\d{2}:\d{2})\b"
)
URL_RE = re.compile(r"https?://[^\s\]\)\"'<>`]+")
READEST_RE = re.compile(r"\breadest://[^\s\]\)\"'<>`]+", flags=re.IGNORECASE)
LARECHERCHE_RE = re.compile(r"\blarecherche/[^\s\]\)\"'<>`]+", flags=re.IGNORECASE)
TWENTY_DOLLAR_WORDS_RE = re.compile(
    r"\b(?:tdw|twenty-dollar-words)/[^\s\]\)\"'<>`]+",
    flags=re.IGNORECASE,
)


def parse_cross_references(text: str | None) -> list[dict[str, Any]]:
    value = str(text or "")
    if not value.strip():
        return []

    references: dict[str, dict[str, Any]] = {}
    for match in DATETIME_STAMP_RE.finditer(value):
        raw = match.group(0).rstrip(".,;)\"']")
        references[raw] = {
            "kind": "datetime-anchor",
            "raw": raw,
            "scheme": match.group("scheme").lower(),
            "namespace": match.group("namespace"),
            "timestamp": match.group("stamp"),
            "target": raw,
        }

    for pattern, kind in [
        (URL_RE, "url"),
        (READEST_RE, "readest-deep-link"),
        (LARECHERCHE_RE, "la-recherche"),
        (TWENTY_DOLLAR_WORDS_RE, "twenty-dollar-words"),
    ]:
        for match in pattern.finditer(value):
            raw = match.group(0).rstrip(".,;)\"']")
            target = normalize_reference_target(raw, kind)
            references.setdefault(
                raw,
                {
                    "kind": kind,
                    "raw": raw,
                    "target": target,
                },
            )

    return sorted(references.values(), key=lambda item: str(item.get("raw") or ""))


def normalize_reference_target(raw: str, kind: str) -> str:
    if kind in {"url", "readest-deep-link"}:
        return raw
    if kind == "la-recherche":
        return f"https://ateliernymphet.com/{raw.lstrip('/')}"
    if kind == "twenty-dollar-words":
        path = raw
        if path.lower().startswith("tdw/"):
            path = f"twenty-dollar-words/{path.split('/', 1)[1]}"
        return f"https://ateliernymphet.com/{path.lstrip('/')}"
    return raw


def markdown_reference_link(reference: dict[str, Any]) -> str:
    raw = str(reference.get("raw") or reference.get("target") or "")
    target = str(reference.get("target") or raw)
    kind = str(reference.get("kind") or "reference")
    if target.startswith(("http://", "https://", "readest://")):
        return f"- `{kind}` [{raw}]({target})"
    return f"- `{kind}` `{raw}`"


def references_as_prompt_payload(references: list[dict[str, Any]]) -> list[dict[str, Any]]:
    return [
        {
            "kind": reference.get("kind"),
            "raw": reference.get("raw"),
            "target": reference.get("target"),
            "scheme": reference.get("scheme"),
            "namespace": reference.get("namespace"),
            "timestamp": reference.get("timestamp"),
        }
        for reference in references
    ]
