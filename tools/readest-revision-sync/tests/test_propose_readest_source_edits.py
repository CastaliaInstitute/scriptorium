from __future__ import annotations

import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, SCRIPT_DIR.as_posix())

import propose_readest_source_edits as propose  # noqa: E402


def record() -> dict:
    return {
        "work_slug": "absinthe",
        "canonical_ref": "https://ateliernymphet.com/larecherche/absinthe/chapter-1#green-hour",
        "source_owner": "AtelierNymphet",
        "source_repo": "Absinthe",
        "source_path": "manuscript/source.md",
        "source_ref": "main",
        "source_char_start": 6,
        "source_char_end": 11,
        "source_hash": "sourcehash",
        "highlight_text": "green hour",
        "reader_note": "tighten this image",
        "highlight_hash": "hash",
        "readest": {
            "book_hash": "bookhash",
            "annotation_id": "note-1",
            "book_title": "Absinthe",
            "annotation_url": "https://web.readest.com/o/book/bookhash/annotation/note-1",
            "annotation_app_url": "readest://book/bookhash/annotation/note-1",
        },
    }


class ProposeReadestSourceEditsTest(unittest.TestCase):
    def test_source_context_resolves_workspace_repo_path(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)
            source = workspace / "Absinthe" / "manuscript" / "source.md"
            source.parent.mkdir(parents=True)
            source.write_text("alpha green hour omega", encoding="utf-8")

            context = propose.source_context(record(), workspace, radius=3)

            self.assertEqual(context.path, source.resolve())
            self.assertEqual(context.window_start, 3)
            self.assertEqual(context.window_end, 14)
            self.assertEqual(context.text, "ha green ho")

    def test_prompt_includes_annotation_and_source_context(self) -> None:
        source_context = propose.SourceContext(
            path=Path("/tmp/source.md"),
            text="green hour context",
            window_start=0,
            window_end=18,
        )

        prompt = propose.proposal_prompt(record(), source_context)

        self.assertEqual(prompt["source"]["path"], "manuscript/source.md")
        self.assertEqual(prompt["annotation"]["reader_note"], "tighten this image")
        self.assertEqual(prompt["source"]["context"], "green hour context")

    def test_fallback_proposal_keeps_review_prompt(self) -> None:
        source_context = propose.SourceContext(path=None, text="", window_start=None, window_end=None)

        fallback = propose.fallback_proposal(record(), source_context, "missing source")

        self.assertEqual(fallback["status"], "needs_manual_review")
        self.assertEqual(fallback["rationale"], "missing source")
        self.assertIn("prompt", fallback)
        self.assertEqual(fallback["prompt"]["annotation"]["highlight_text"], "green hour")


if __name__ == "__main__":
    unittest.main()
