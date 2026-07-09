from __future__ import annotations

import re
import urllib.parse
from typing import Any


REFERENCE_SCHEMA = "scriptorium.cross-reference.v1"

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
            "schema": REFERENCE_SCHEMA,
            "kind": "datetime-anchor",
            "raw": raw,
            "scheme": match.group("scheme").lower(),
            "namespace": match.group("namespace"),
            "timestamp": match.group("stamp"),
            "target": raw,
            "canonical_uri": message_canonical_uri(
                match.group("scheme").lower(),
                match.group("namespace"),
                match.group("stamp"),
            ),
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
                    "schema": REFERENCE_SCHEMA,
                    "kind": kind,
                    "raw": raw,
                    "target": target,
                    "canonical_uri": canonical_uri(raw, kind),
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


def canonical_uri(raw: str, kind: str) -> str:
    if kind in {"url", "readest-deep-link"}:
        return raw
    if kind == "la-recherche":
        return work_canonical_uri(raw)
    if kind == "twenty-dollar-words":
        path = raw
        if path.lower().startswith("tdw/"):
            path = f"twenty-dollar-words/{path.split('/', 1)[1]}"
        return work_canonical_uri(path)
    return raw


def work_canonical_uri(path: str) -> str:
    parts = [part for part in path.strip("/").split("/") if part]
    if parts and parts[0].lower() == "larecherche":
        parts[0] = "la-recherche"
    encoded = "/".join(urllib.parse.quote(part, safe="-._~") for part in parts)
    return f"scriptorium://work/{encoded}"


def message_canonical_uri(scheme: str, namespace: str, timestamp: str) -> str:
    return (
        "scriptorium://message/"
        f"{urllib.parse.quote(scheme, safe='-._~')}/"
        f"{urllib.parse.quote(namespace, safe='-._~')}/"
        f"{urllib.parse.quote(timestamp, safe='-._~')}"
    )


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
            "schema": reference.get("schema"),
            "raw": reference.get("raw"),
            "target": reference.get("target"),
            "canonical_uri": reference.get("canonical_uri"),
            "scheme": reference.get("scheme"),
            "namespace": reference.get("namespace"),
            "timestamp": reference.get("timestamp"),
        }
        for reference in references
    ]
