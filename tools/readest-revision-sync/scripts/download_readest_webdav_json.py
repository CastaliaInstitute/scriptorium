#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import os
import re
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


JSON_RE = re.compile(r"(^|/)(library\.json|config\.json)$")


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"missing required environment variable: {name}")
    return value


def auth_header(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def request(method: str, url: str, headers: dict[str, str], body: bytes | None = None) -> bytes:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.read()
    except urllib.error.HTTPError as error:
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{method} {url} failed: HTTP {error.code}\n{detail}") from error


def propfind(url: str, headers: dict[str, str], depth: str) -> list[str]:
    xml = request("PROPFIND", url, {**headers, "Depth": depth}, b"")
    root = ET.fromstring(xml)
    hrefs: list[str] = []
    for elem in root.findall(".//{DAV:}href"):
        if elem.text:
            hrefs.append(elem.text)
    return hrefs


def discover_json_hrefs(root_url: str, headers: dict[str, str]) -> list[str]:
    seen_dirs: set[str] = set()
    json_hrefs: set[str] = set()

    def walk(url: str) -> None:
        normalized = url.rstrip("/") + "/"
        if normalized in seen_dirs:
            return
        seen_dirs.add(normalized)
        for href in propfind(normalized, headers, "1"):
            path = urllib.parse.unquote(urllib.parse.urlparse(href).path)
            if JSON_RE.search(path):
                json_hrefs.add(href)
                continue
            if path.endswith("/"):
                child_url = href_to_url(normalized, href)
                if child_url.rstrip("/") + "/" != normalized:
                    walk(child_url)

    walk(root_url)
    return sorted(json_hrefs)


def href_to_url(base_url: str, href: str) -> str:
    parsed_base = urllib.parse.urlparse(base_url)
    parsed_href = urllib.parse.urlparse(href)
    if parsed_href.scheme:
        return href
    return urllib.parse.urlunparse((parsed_base.scheme, parsed_base.netloc, parsed_href.path, "", "", ""))


def local_path_for_href(out_dir: Path, root_path: str, href: str) -> Path:
    path = urllib.parse.unquote(urllib.parse.urlparse(href).path)
    relative = path
    if root_path and path.startswith(root_path):
        relative = path[len(root_path):]
    relative = relative.strip("/") or "library.json"
    return out_dir / relative


def main() -> int:
    parser = argparse.ArgumentParser(description="Download Readest library/config JSON files from WebDAV.")
    parser.add_argument("--remote-root", default=os.environ.get("READEST_WEBDAV_ROOT", ""))
    parser.add_argument("--out-dir", type=Path, default=Path("output/readest/webdav"))
    args = parser.parse_args()

    base = env("WEBDAV_URL").rstrip("/")
    root = args.remote_root.strip("/")
    root_url = f"{base}/{urllib.parse.quote(root)}/" if root else f"{base}/"
    root_path = urllib.parse.urlparse(root_url).path.rstrip("/") + "/"
    headers = {
        "Authorization": auth_header(env("WEBDAV_USERNAME"), env("WEBDAV_PASSWORD")),
        "User-Agent": "ateliernymphet-readest-json-sync",
    }

    json_hrefs = discover_json_hrefs(root_url, headers)
    if not json_hrefs:
        raise SystemExit(f"no library.json/config.json files found under {root_url}")

    for href in sorted(json_hrefs):
        url = href_to_url(root_url, href)
        out_path = local_path_for_href(args.out_dir, root_path, href)
        out_path.parent.mkdir(parents=True, exist_ok=True)
        out_path.write_bytes(request("GET", url, headers))
        print(out_path.as_posix())

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
