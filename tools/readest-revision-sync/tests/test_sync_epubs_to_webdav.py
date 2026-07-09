from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, SCRIPT_DIR.as_posix())

import sync_epubs_to_webdav as sync  # noqa: E402


class SyncEpubsToWebdavTest(unittest.TestCase):
    def test_webdav_base_url_rejects_placeholder_without_host(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            sync.webdav_base_url("https://")

        self.assertIn("invalid WEBDAV_URL", str(raised.exception))

    def test_webdav_base_url_rejects_relative_url(self) -> None:
        with self.assertRaises(SystemExit) as raised:
            sync.webdav_base_url("readest-webdav")

        self.assertIn("absolute http(s) URL", str(raised.exception))

    def test_webdav_base_url_strips_trailing_slash(self) -> None:
        self.assertEqual(
            sync.webdav_base_url("https://readest-webdav.example.test/"),
            "https://readest-webdav.example.test",
        )

    def test_remote_relative_flattens_to_filename(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            epub = root / "series" / "book.epub"
            epub.parent.mkdir()
            epub.write_bytes(b"epub")

            self.assertEqual(sync.remote_relative(epub, root, flatten=True), Path("book.epub"))

    def test_expand_epubs_deduplicates_and_ignores_non_epubs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            root = Path(tmpdir)
            (root / "a.epub").write_bytes(b"epub")
            (root / "a.txt").write_text("no", encoding="utf-8")

            found = sync.expand_epubs([(root / "*").as_posix(), (root / "*.epub").as_posix()])

            self.assertEqual(found, [(root / "a.epub").resolve()])

    def test_preflight_webdav_checks_options_root(self) -> None:
        calls = []
        original_request = sync.request

        def fake_request(method: str, url: str, headers: dict[str, str], body: bytes | None = None):
            calls.append((method, url, headers, body))
            return 204, b""

        try:
            sync.request = fake_request
            sync.preflight_webdav("https://readest-webdav.example.test", {"Authorization": "Basic token"})
        finally:
            sync.request = original_request

        self.assertEqual(
            calls,
            [
                (
                    "OPTIONS",
                    "https://readest-webdav.example.test/",
                    {"Authorization": "Basic token"},
                    None,
                )
            ],
        )

    def test_preflight_webdav_rejects_unexpected_status(self) -> None:
        original_request = sync.request

        def fake_request(method: str, url: str, headers: dict[str, str], body: bytes | None = None):
            return 500, b""

        try:
            sync.request = fake_request
            with self.assertRaises(SystemExit) as raised:
                sync.preflight_webdav("https://readest-webdav.example.test", {})
        finally:
            sync.request = original_request

        self.assertIn("OPTIONS https://readest-webdav.example.test/ failed: HTTP 500", str(raised.exception))


if __name__ == "__main__":
    unittest.main()
