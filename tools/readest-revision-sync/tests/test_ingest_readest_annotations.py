from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, SCRIPT_DIR.as_posix())

import ingest_readest_annotations as ingest  # noqa: E402


class IngestReadestAnnotationsTest(unittest.TestCase):
    def test_load_source_map_fails_when_missing_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            missing = Path(tmpdir) / "missing.jsonl"

            with self.assertRaises(SystemExit) as raised:
                ingest.load_source_map(missing)

            self.assertIn("source map not found", str(raised.exception))

    def test_load_source_map_allows_missing_when_explicitly_requested(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            missing = Path(tmpdir) / "missing.jsonl"

            self.assertEqual(ingest.load_source_map(missing, allow_empty=True), [])

    def test_load_source_map_fails_when_empty_by_default(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            source_map = Path(tmpdir) / "manifest.jsonl"
            source_map.write_text("\n", encoding="utf-8")

            with self.assertRaises(SystemExit) as raised:
                ingest.load_source_map(source_map)

            self.assertIn("source map has no canonical entries", str(raised.exception))

    def test_load_source_map_reads_atelier_manifest_shape(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            source_map = Path(tmpdir) / "manifest.jsonl"
            payload = {
                "document": {
                    "work_slug": "absinthe",
                    "title": "Absinthe",
                    "github_owner": "AtelierNymphet",
                    "github_repo": "AtelierNymphet",
                    "github_ref": "main",
                },
                "chunk": {
                    "canonical_ref": "https://ateliernymphet.com/larecherche/absinthe/chapter-1#green-hour",
                    "fragment": "green-hour",
                    "github_path": "Absinthe/source/chapter-1.md",
                    "char_start": 10,
                    "char_end": 42,
                    "content": "The green hour begins here.",
                },
            }
            source_map.write_text(json.dumps(payload) + "\n", encoding="utf-8")

            entries = ingest.load_source_map(source_map)

            self.assertEqual(len(entries), 1)
            self.assertEqual(entries[0].work_slug, "absinthe")
            self.assertEqual(entries[0].github_path, "Absinthe/source/chapter-1.md")
            self.assertEqual(entries[0].canonical_ref, payload["chunk"]["canonical_ref"])

    def test_normalized_record_includes_structured_source_link(self) -> None:
        entry = ingest.SourceMapEntry(
            work_slug="absinthe",
            title="Absinthe",
            canonical_ref="https://ateliernymphet.com/larecherche/absinthe/chapter-1#green-hour",
            fragment="green-hour",
            github_owner="AtelierNymphet",
            github_repo="AtelierNymphet",
            github_ref="main",
            github_path="Absinthe/source/chapter 1.md",
            char_start=10,
            char_end=42,
            content="The green hour begins here.",
            content_hash="content-hash",
        )

        normalized = ingest.normalized_record(
            {"hash": "bookhash", "title": "Absinthe", "author": "Daniel"},
            {"schemaVersion": 3},
            {
                "id": "note-1",
                "text": "The green hour",
                "note": "compare tdw/absinthe/green-hour",
                "cfi": "epubcfi(/6/2!/4/1:0)",
            },
            ingest.MatchResult("mapped", "high", "matched", entry),
        )

        self.assertEqual(normalized["source_link"]["repository"], "AtelierNymphet/AtelierNymphet")
        self.assertEqual(normalized["source_link"]["path"], "Absinthe/source/chapter 1.md")
        self.assertEqual(normalized["source_link"]["char_start"], 10)
        self.assertEqual(normalized["source_link"]["char_end"], 42)
        self.assertEqual(
            normalized["source_link"]["github_url"],
            "https://github.com/AtelierNymphet/AtelierNymphet/blob/main/Absinthe/source/chapter%201.md",
        )

    def test_normalized_record_detects_explicit_marginalia_layer(self) -> None:
        normalized = ingest.normalized_record(
            {"hash": "bookhash", "title": "Absinthe"},
            {"schemaVersion": 3},
            {
                "id": "note-1",
                "text": "The green hour",
                "note": "[layer:faculty] compare this in seminar",
                "type": "highlight",
            },
            ingest.MatchResult("quarantine", "none", "manual"),
        )

        self.assertEqual(normalized["marginalia_layer"], "faculty")
        self.assertEqual(normalized["marginalia"]["schema"], "scriptorium.marginalia.v1")
        self.assertEqual(normalized["marginalia"]["layer"], "faculty")
        self.assertEqual(normalized["marginalia"]["kind"], "highlight")

    def test_normalized_record_defaults_marginalia_layer_to_personal(self) -> None:
        normalized = ingest.normalized_record(
            {"hash": "bookhash", "title": "Absinthe"},
            {"schemaVersion": 3},
            {"id": "note-1", "text": "The green hour", "note": "ordinary note"},
            ingest.MatchResult("quarantine", "none", "manual"),
        )

        self.assertEqual(normalized["marginalia_layer"], "personal")


if __name__ == "__main__":
    unittest.main()
