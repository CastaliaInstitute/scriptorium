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


if __name__ == "__main__":
    unittest.main()
