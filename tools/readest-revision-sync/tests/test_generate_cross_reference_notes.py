from __future__ import annotations

import json
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, SCRIPT_DIR.as_posix())

import generate_cross_reference_notes as notes  # noqa: E402


def record(annotation_id: str, work_slug: str = "absinthe") -> dict:
    return {
        "work_slug": work_slug,
        "canonical_ref": f"https://ateliernymphet.com/larecherche/{work_slug}/chapter-1#green-hour",
        "source_path": f"{work_slug}/source/chapter-1.md",
        "source_link": {
            "github_url": f"https://github.com/AtelierNymphet/AtelierNymphet/blob/main/{work_slug}/source/chapter-1.md",
        },
        "highlight_text": "The green hour",
        "reader_note": "compare tdw/absinthe/green-hour",
        "marginalia_layer": "faculty",
        "highlight_hash": "abcdef1234567890",
        "readest": {
            "annotation_id": annotation_id,
            "annotation_url": f"https://web.readest.com/o/book/bookhash/annotation/{annotation_id}",
            "annotation_app_url": f"readest://book/bookhash/annotation/{annotation_id}",
        },
        "cross_references": [
            {
                "schema": "scriptorium.cross-reference.v1",
                "kind": "twenty-dollar-words",
                "raw": "tdw/absinthe/green-hour",
                "target": "https://ateliernymphet.com/twenty-dollar-words/absinthe/green-hour",
                "canonical_uri": "scriptorium://work/twenty-dollar-words/absinthe/green-hour",
            }
        ],
    }


class GenerateCrossReferenceNotesTest(unittest.TestCase):
    def test_grouped_records_ignores_records_without_cross_references(self) -> None:
        empty = record("note-2")
        empty["cross_references"] = []

        grouped = notes.grouped_records([record("note-1"), empty])

        self.assertEqual(list(grouped), ["absinthe"])
        self.assertEqual(len(grouped["absinthe"]), 1)

    def test_render_work_notes_contains_stable_note_and_tdw_link(self) -> None:
        rendered = notes.render_work_notes("absinthe", [record("note-1")])

        self.assertIn("schema: scriptorium.cross-reference-notes.v1", rendered)
        self.assertIn('id="sr-xref-0001-note-1-abcdef123456"', rendered)
        self.assertIn("Marginalia layer: `faculty`", rendered)
        self.assertIn(
            "[tdw/absinthe/green-hour](https://ateliernymphet.com/twenty-dollar-words/absinthe/green-hour)",
            rendered,
        )

    def test_write_notes_writes_one_file_per_work_and_summary(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            out_dir = Path(tmpdir) / "notes"
            written = notes.write_notes([record("note-1"), record("note-2", "isibella")], out_dir)

            self.assertEqual(
                [path.name for path in written],
                ["absinthe.cross-reference-endnotes.md", "isibella.cross-reference-endnotes.md"],
            )
            summary = json.loads((out_dir / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(summary["schema"], "scriptorium.cross-reference-notes.v1")
            self.assertEqual(summary["work_count"], 2)


if __name__ == "__main__":
    unittest.main()
