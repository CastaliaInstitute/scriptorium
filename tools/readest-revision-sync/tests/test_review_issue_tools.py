from __future__ import annotations

import json
import subprocess
import sys
import unittest
from pathlib import Path
from unittest.mock import patch


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, SCRIPT_DIR.as_posix())

import create_readest_review_issues as issues  # noqa: E402
from readest_cross_references import parse_cross_references  # noqa: E402


def record(annotation_id: str, highlight_hash: str = "hash") -> dict:
    return {
        "work_slug": "absinthe",
        "canonical_ref": "https://ateliernymphet.com/larecherche/absinthe/chapter-1#green-hour",
        "source_repo": "AtelierNymphet",
        "source_path": "source/absinthe.md",
        "source_ref": "main",
        "match_confidence": "high",
        "highlight_text": "green hour",
        "reader_note": "compare facebook:daniel-du-kinque:2026.07.02.02:24",
        "highlight_hash": highlight_hash,
        "readest": {
            "book_hash": "bookhash",
            "annotation_id": annotation_id,
            "annotation_url": "https://web.readest.com/o/book/bookhash/annotation/note",
            "annotation_app_url": "readest://book/bookhash/annotation/note",
            "book_url": "https://web.readest.com/o/book/bookhash",
            "cfi": "/6/2",
        },
    }


class ReviewIssueToolsTest(unittest.TestCase):
    def test_issue_key_is_stable_and_annotation_specific(self) -> None:
        first = issues.issue_key(record("note-1"))
        second = issues.issue_key(record("note-1"))
        third = issues.issue_key(record("note-2"))

        self.assertEqual(first, second)
        self.assertEqual(first, "readest:bookhash:note-1:hash")
        self.assertNotEqual(first, third)

    def test_existing_issue_keys_extracts_marker_from_gh_json(self) -> None:
        payload = [
            {"body": "before <!-- readest-review-key: readest:book:a:h1 --> after"},
            {"body": "no marker"},
            {"body": "<!-- readest-review-key: readest:book:b:h2 -->"},
        ]

        completed = subprocess.CompletedProcess(
            args=["gh"],
            returncode=0,
            stdout=json.dumps(payload),
            stderr="",
        )

        with patch("create_readest_review_issues.subprocess.run", return_value=completed):
            self.assertEqual(
                issues.existing_issue_keys(),
                {"readest:book:a:h1", "readest:book:b:h2"},
            )

    def test_plan_review_issues_skips_seen_keys_and_honors_limit(self) -> None:
        records = [record("note-1"), record("note-2"), record("note-3")]
        seen = {issues.issue_key(records[0])}
        created: list[tuple[str, str]] = []

        def summarize(item: dict) -> dict[str, str]:
            return {
                "title": f"title {item['readest']['annotation_id']}",
                "summary": "summary",
                "proposed_next_step": "next",
            }

        def create(title: str, body: str, labels: list[str], dry_run: bool) -> None:
            created.append((title, body))

        count = issues.plan_review_issues(
            records=records,
            seen=seen,
            limit=1,
            labels=["readest-review"],
            dry_run=True,
            summarize=summarize,
            create=create,
        )

        self.assertEqual(count, 1)
        self.assertEqual(len(created), 1)
        self.assertEqual(created[0][0], "title note-2")
        self.assertIn("<!-- readest-review-key: readest:bookhash:note-2:hash -->", created[0][1])

    def test_cross_reference_parser_normalizes_supported_references(self) -> None:
        parsed = parse_cross_references(
            "See facebook:daniel-du-kinque:2026.07.02.02:24, "
            "larecherche/absinthe/chapter-1, tdw/absinthe/green-hour, "
            "readest://book/abc/annotation/def, and https://example.test/a."
        )
        by_kind = {item["kind"]: item for item in parsed}

        self.assertEqual(by_kind["datetime-anchor"]["timestamp"], "2026.07.02.02:24")
        self.assertEqual(
            by_kind["la-recherche"]["target"],
            "https://ateliernymphet.com/larecherche/absinthe/chapter-1",
        )
        self.assertEqual(
            by_kind["twenty-dollar-words"]["target"],
            "https://ateliernymphet.com/twenty-dollar-words/absinthe/green-hour",
        )
        self.assertEqual(by_kind["readest-deep-link"]["target"], "readest://book/abc/annotation/def")
        self.assertEqual(by_kind["url"]["target"], "https://example.test/a")


if __name__ == "__main__":
    unittest.main()
