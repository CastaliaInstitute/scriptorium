from __future__ import annotations

import subprocess
import sys
import tempfile
import unittest
from pathlib import Path


SCRIPT_DIR = Path(__file__).resolve().parents[1] / "scripts"
sys.path.insert(0, SCRIPT_DIR.as_posix())

import apply_accepted_readest_source_edits as apply_edits  # noqa: E402


def proposal(key: str = "readest-edit:book:note:hash", status: str = "proposed", diff: str = "") -> dict:
    return {
        "key": key,
        "source_repo": "Absinthe",
        "source_path": "manuscript/source.md",
        "proposal": {
            "status": status,
            "rationale": "tighten wording",
            "unified_diff": diff,
            "edited_excerpt": "green hour",
        },
    }


class ApplyAcceptedSourceEditsTest(unittest.TestCase):
    def test_selects_only_explicitly_accepted_proposed_diffs(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)
            target = workspace / "Absinthe"
            target.mkdir()

            selected = apply_edits.select_accepted_proposals(
                [proposal(diff=valid_diff())],
                {"readest-edit:book:note:hash"},
                workspace,
            )

            self.assertEqual(len(selected), 1)
            self.assertEqual(selected[0].target_root, target.resolve())
            self.assertEqual(selected[0].source_path, "manuscript/source.md")

    def test_rejects_manual_review_proposals_even_when_key_is_accepted(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            with self.assertRaises(SystemExit) as raised:
                apply_edits.select_accepted_proposals(
                    [proposal(status="needs_manual_review", diff=valid_diff())],
                    {"readest-edit:book:note:hash"},
                    Path(tmpdir),
                )

            self.assertIn("not 'proposed'", str(raised.exception))

    def test_apply_group_validates_and_applies_diff(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            repo = Path(tmpdir)
            (repo / "manuscript").mkdir()
            source = repo / "manuscript" / "source.md"
            source.write_text("alpha green hour omega\n", encoding="utf-8")
            subprocess.run(["git", "init"], cwd=repo, check=True, stdout=subprocess.PIPE)
            subprocess.run(["git", "add", "manuscript/source.md"], cwd=repo, check=True)
            subprocess.run(
                ["git", "-c", "user.name=Test", "-c", "user.email=test@example.com", "commit", "-m", "init"],
                cwd=repo,
                check=True,
                stdout=subprocess.PIPE,
            )

            accepted = apply_edits.AcceptedProposal(
                key="readest-edit:book:note:hash",
                source_owner="AtelierNymphet",
                source_repo="Absinthe",
                source_path="manuscript/source.md",
                target_root=repo,
                unified_diff=valid_diff(),
            )

            apply_edits.apply_group([accepted], dry_run=False)

            self.assertEqual(source.read_text(encoding="utf-8"), "alpha green hour, revised omega\n")

    def test_accepted_keys_file_supports_plain_lines(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            path = Path(tmpdir) / "accepted.txt"
            path.write_text("# comment\nreadest-edit:book:note:hash\n", encoding="utf-8")

            self.assertEqual(
                apply_edits.accepted_keys_from_file(path),
                {"readest-edit:book:note:hash"},
            )

    def test_source_repos_for_proposals_uses_record_owner_and_default_owner(self) -> None:
        proposals = [
            apply_edits.AcceptedProposal(
                key="owned",
                source_owner="AtelierNymphet",
                source_repo="Absinthe",
                source_path="manuscript/source.md",
                target_root=Path("/tmp/Absinthe"),
                unified_diff=valid_diff(),
            ),
            apply_edits.AcceptedProposal(
                key="defaulted",
                source_owner="",
                source_repo="TheTrial",
                source_path="README.md",
                target_root=Path("/tmp/TheTrial"),
                unified_diff=valid_diff(),
            ),
        ]

        self.assertEqual(
            apply_edits.source_repos_for_proposals(proposals, "AtelierNymphet"),
            ["AtelierNymphet/Absinthe", "AtelierNymphet/TheTrial"],
        )

    def test_selects_multiple_target_roots_from_source_repo_checkouts(self) -> None:
        with tempfile.TemporaryDirectory() as tmpdir:
            workspace = Path(tmpdir)
            (workspace / "Absinthe").mkdir()
            (workspace / "TheTrial").mkdir()

            records = [
                proposal("readest-edit:absinthe", diff=valid_diff()),
                {
                    **proposal("readest-edit:trial", diff=valid_diff()),
                    "source_repo": "TheTrial",
                    "source_path": "README.md",
                },
            ]

            selected = apply_edits.select_accepted_proposals(
                records,
                {"readest-edit:absinthe", "readest-edit:trial"},
                workspace,
            )

            self.assertEqual(
                sorted(item.target_root.name for item in selected),
                ["Absinthe", "TheTrial"],
            )


def valid_diff() -> str:
    return """diff --git a/manuscript/source.md b/manuscript/source.md
index 1c2564c..9b95b8d 100644
--- a/manuscript/source.md
+++ b/manuscript/source.md
@@ -1 +1 @@
-alpha green hour omega
+alpha green hour, revised omega
"""


if __name__ == "__main__":
    unittest.main()
