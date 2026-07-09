#!/usr/bin/env python3
from __future__ import annotations

import argparse
import base64
import glob
import os
import sys
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from pathlib import Path


def env(name: str) -> str:
    value = os.environ.get(name)
    if not value:
        raise SystemExit(f"missing required environment variable: {name}")
    return value


def webdav_base_url(value: str) -> str:
    parsed = urllib.parse.urlparse(value.strip())
    if parsed.scheme not in {"http", "https"} or not parsed.netloc:
        raise SystemExit(
            "invalid WEBDAV_URL: expected an absolute http(s) URL with a host, "
            "for example https://readest-webdav-example.run.app"
        )
    return value.strip().rstrip("/")


def auth_header(username: str, password: str) -> str:
    token = base64.b64encode(f"{username}:{password}".encode("utf-8")).decode("ascii")
    return f"Basic {token}"


def quote_path(path: str) -> str:
    return "/".join(urllib.parse.quote(part) for part in path.split("/") if part)


def request(method: str, url: str, headers: dict[str, str], body: bytes | None = None) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=body, headers=headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=120) as response:
            return response.status, response.read()
    except urllib.error.HTTPError as error:
        if method == "MKCOL" and error.code in {405, 409}:
            return error.code, b""
        if method == "PROPFIND" and error.code == 404:
            return error.code, b""
        detail = error.read().decode("utf-8", errors="replace")
        raise SystemExit(f"{method} {url} failed: HTTP {error.code}\n{detail}") from error


def ensure_collections(base_url: str, remote_path: str, headers: dict[str, str]) -> None:
    parts = [part for part in remote_path.split("/") if part][:-1]
    current: list[str] = []
    for part in parts:
        current.append(part)
        url = f"{base_url}/{quote_path('/'.join(current))}/"
        request("MKCOL", url, headers)


def propfind(base_url: str, remote_path: str, headers: dict[str, str]) -> list[str]:
    url = f"{base_url}/{quote_path(remote_path).rstrip('/')}/"
    status, body = request("PROPFIND", url, {**headers, "Depth": "1"}, b"")
    if status == 404:
        return []
    root = ET.fromstring(body)
    return [elem.text or "" for elem in root.findall(".//{DAV:}href")]


def href_to_relative(prefix: str, href: str) -> str | None:
    path = urllib.parse.unquote(urllib.parse.urlparse(href).path).strip("/")
    prefix = prefix.strip("/")
    if path == prefix:
        return None
    if not path.startswith(prefix + "/"):
        return None
    return path[len(prefix) + 1 :]


def remote_epubs(base_url: str, prefix: str, headers: dict[str, str]) -> set[str]:
    seen_dirs: set[str] = set()
    found: set[str] = set()

    def walk(path: str) -> None:
        normalized = path.strip("/")
        if normalized in seen_dirs:
            return
        seen_dirs.add(normalized)
        for href in propfind(base_url, normalized, headers):
            relative = href_to_relative(prefix, href)
            if relative is None:
                continue
            if href.endswith("/"):
                walk("/".join([prefix.strip("/"), relative]).strip("/"))
            elif relative.lower().endswith(".epub"):
                found.add(relative)

    walk(prefix)
    return found


def expand_epubs(patterns: list[str]) -> list[Path]:
    files: list[Path] = []
    for pattern in patterns:
        files.extend(Path(path) for path in glob.glob(pattern, recursive=True))
    unique = sorted({path.resolve() for path in files if path.is_file() and path.suffix.lower() == ".epub"})
    return unique


def remote_relative(epub: Path, cwd: Path, flatten: bool) -> Path:
    if flatten:
        return Path(epub.name)
    try:
        return epub.relative_to(cwd)
    except ValueError:
        return Path(epub.name)


def main() -> int:
    parser = argparse.ArgumentParser(description="Upload EPUB artifacts to a Readest WebDAV endpoint.")
    parser.add_argument("patterns", nargs="*", default=["output/epub/*.epub"], help="EPUB globs to upload.")
    parser.add_argument("--remote-prefix", default=os.environ.get("WEBDAV_REMOTE_PREFIX", ""))
    parser.add_argument("--flatten", action="store_true", help="Upload all EPUBs directly under the remote prefix.")
    parser.add_argument("--mirror", action="store_true", help="Delete remote EPUBs under the prefix that are no longer matched locally.")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--allow-empty", action="store_true", help="Exit successfully when no EPUB files match.")
    args = parser.parse_args()

    epubs = expand_epubs(args.patterns)
    if not epubs:
        print("no EPUB files matched", file=sys.stderr)
        return 0 if args.allow_empty else 1

    if args.dry_run:
        base_url = webdav_base_url(os.environ.get("WEBDAV_URL", "https://webdav.example.invalid"))
        headers = {"User-Agent": "ateliernymphet-epub-sync"}
    else:
        base_url = webdav_base_url(env("WEBDAV_URL"))
        username = env("WEBDAV_USERNAME")
        password = env("WEBDAV_PASSWORD")
        headers = {
            "Authorization": auth_header(username, password),
            "User-Agent": "ateliernymphet-epub-sync",
        }

    cwd = Path.cwd().resolve()
    desired: dict[str, Path] = {}
    duplicate_names: dict[str, list[Path]] = {}
    for epub in epubs:
        relative = remote_relative(epub, cwd, args.flatten).as_posix()
        duplicate_names.setdefault(relative, []).append(epub)
        desired[relative] = epub

    duplicates = {name: paths for name, paths in duplicate_names.items() if len(paths) > 1}
    if duplicates:
        detail = "\n".join(f"{name}: {', '.join(str(path) for path in paths)}" for name, paths in sorted(duplicates.items()))
        raise SystemExit(f"duplicate remote EPUB path(s); use non-flattened sync or rename artifacts:\n{detail}")

    if args.mirror and not args.dry_run:
        current = remote_epubs(base_url, args.remote_prefix, headers)
        stale = sorted(current - set(desired))
        for relative in stale:
            remote_path = "/".join([args.remote_prefix.strip("/"), relative])
            remote_url = f"{base_url}/{quote_path(remote_path)}"
            print(f"DELETE {remote_path}")
            request("DELETE", remote_url, headers)
    elif args.mirror and args.dry_run:
        print("MIRROR dry-run: remote delete scan skipped")

    for relative, epub in desired.items():
        remote_path = "/".join([args.remote_prefix.strip("/"), relative])
        remote_url = f"{base_url}/{quote_path(remote_path)}"
        print(f"PUT {epub.relative_to(cwd) if epub.is_relative_to(cwd) else epub.name} -> {remote_path}")
        if args.dry_run:
            continue
        ensure_collections(base_url, remote_path, headers)
        body = epub.read_bytes()
        put_headers = {
            **headers,
            "Content-Type": "application/epub+zip",
            "Content-Length": str(len(body)),
        }
        request("PUT", remote_url, put_headers, body)

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
