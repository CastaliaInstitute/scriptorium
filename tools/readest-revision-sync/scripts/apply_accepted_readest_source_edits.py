#!/usr/bin/env python3
from __future__ import annotations

import argparse
import json
import subprocess
from collections import defaultdict
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Iterable


DEFAULT_INPUT = Path(".atelier/readest-edit-proposals/readest-source-edit-proposals.jsonl")


@dataclass(frozen=True)
class AcceptedProposal:
    key: str
    source_repo: str
    source_path: str
    target_root: Path
    unified_diff: str


def iter_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        raise SystemExit(f"input not found: {path}")
    records: list[dict[str, Any]] = []
    with path.open("r", encoding="utf-8") as handle:
        for line_number, line in enumerate(handle, start=1):
            stripped = line.strip()
            if not stripped:
                continue
            try:
                records.append(json.loads(stripped))
            except json.JSONDecodeError as error:
                raise SystemExit(f"failed to parse {path}:{line_number}: {error}") from error
    return records


def accepted_keys_from_file(path: Path) -> set[str]:
    if not path.exists():
        raise SystemExit(f"accepted keys file not found: {path}")
    text = path.read_text(encoding="utf-8").strip()
    if not text:
        return set()

    if path.suffix == ".json":
        payload = json.loads(text)
        if isinstance(payload, list):
            return {str(item) for item in payload}
        if isinstance(payload, dict):
            values = payload.get("accepted_keys") or payload.get("keys") or []
            if not isinstance(values, list):
                raise SystemExit(f"{path} must contain an accepted_keys or keys list")
            return {str(item) for item in values}
        raise SystemExit(f"{path} must contain a JSON list or object")

    accepted: set[str] = set()
    for line_number, line in enumerate(text.splitlines(), start=1):
        stripped = line.strip()
        if not stripped or stripped.startswith("#"):
            continue
        if stripped.startswith("{"):
            item = json.loads(stripped)
            key = item.get("key")
            if item.get("accepted") is True and key:
                accepted.add(str(key))
            continue
        accepted.add(stripped)
    return accepted


def merge_accepted_keys(cli_keys: Iterable[str], files: Iterable[Path]) -> set[str]:
    keys = {key for key in cli_keys if key}
    for path in files:
        keys.update(accepted_keys_from_file(path))
    if not keys:
        raise SystemExit("no accepted proposal keys supplied; pass --accept-key or --accepted-keys-file")
    return keys


def resolve_target_root(item: dict[str, Any], workspace_root: Path, target_repo_root: Path | None) -> Path:
    if target_repo_root is not None:
        return target_repo_root.resolve()
    source_repo = item.get("source_repo")
    if isinstance(source_repo, str) and source_repo:
        candidate = workspace_root / source_repo
        if candidate.exists():
            return candidate.resolve()
    return workspace_root.resolve()


def select_accepted_proposals(
    records: list[dict[str, Any]],
    accepted_keys: set[str],
    workspace_root: Path,
    target_repo_root: Path | None = None,
) -> list[AcceptedProposal]:
    by_key = {str(item.get("key") or ""): item for item in records if item.get("key")}
    missing = sorted(accepted_keys - set(by_key))
    if missing:
        raise SystemExit("accepted proposal keys not found: " + ", ".join(missing))

    selected: list[AcceptedProposal] = []
    rejected: list[str] = []
    for key in sorted(accepted_keys):
        item = by_key[key]
        proposal = item.get("proposal") or {}
        status = proposal.get("status")
        unified_diff = proposal.get("unified_diff") or ""
        if status != "proposed":
            rejected.append(f"{key}: status is {status!r}, not 'proposed'")
            continue
        if not unified_diff.strip():
            rejected.append(f"{key}: proposed item has no unified_diff")
            continue

        selected.append(
            AcceptedProposal(
                key=key,
                source_repo=str(item.get("source_repo") or ""),
                source_path=str(item.get("source_path") or ""),
                target_root=resolve_target_root(item, workspace_root, target_repo_root),
                unified_diff=unified_diff,
            )
        )

    if rejected:
        raise SystemExit("cannot apply accepted proposals:\n" + "\n".join(f"- {item}" for item in rejected))
    return selected


def run(command: list[str], cwd: Path, input_text: str | None = None, dry_run: bool = False) -> subprocess.CompletedProcess[str]:
    if dry_run:
        print(f"dry-run: ({cwd}) {' '.join(command)}")
        return subprocess.CompletedProcess(command, 0, "", "")
    result = subprocess.run(
        command,
        cwd=cwd,
        input=input_text,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    if result.returncode != 0:
        detail = (result.stderr or result.stdout or "").strip()
        raise SystemExit(f"command failed in {cwd}: {' '.join(command)}\n{detail}")
    return result


def require_clean_worktree(target_root: Path) -> None:
    result = run(["git", "status", "--porcelain"], target_root)
    if result.stdout.strip():
        raise SystemExit(
            f"refusing to create a branch/commit with a dirty worktree in {target_root}; "
            "commit or stash unrelated changes first"
        )


def apply_group(proposals: list[AcceptedProposal], dry_run: bool) -> None:
    for proposal in proposals:
        run(["git", "apply", "--check", "-"], proposal.target_root, input_text=proposal.unified_diff)
    for proposal in proposals:
        if dry_run:
            print(f"would apply {proposal.key} in {proposal.target_root}")
            continue
        run(["git", "apply", "-"], proposal.target_root, input_text=proposal.unified_diff)
        print(f"applied {proposal.key} in {proposal.target_root}")


def create_branch_commit_and_pr(
    target_root: Path,
    branch: str,
    message: str,
    body: str,
    dry_run: bool,
    create_pr: bool,
) -> None:
    run(["git", "switch", "-c", branch], target_root, dry_run=dry_run)
    run(["git", "add", "-A"], target_root, dry_run=dry_run)
    run(["git", "commit", "-m", message], target_root, dry_run=dry_run)
    if create_pr:
        run(["git", "push", "-u", "origin", branch], target_root, dry_run=dry_run)
        run(["gh", "pr", "create", "--fill", "--body", body], target_root, dry_run=dry_run)


def summarize(proposals: list[AcceptedProposal]) -> dict[str, Any]:
    return {
        "accepted": len(proposals),
        "target_roots": sorted({proposal.target_root.as_posix() for proposal in proposals}),
        "keys": [proposal.key for proposal in proposals],
    }


def main() -> int:
    parser = argparse.ArgumentParser(
        description="Apply explicitly accepted Readest source-edit proposal diffs to source repositories."
    )
    parser.add_argument("--input", type=Path, default=DEFAULT_INPUT)
    parser.add_argument("--workspace-root", type=Path, default=Path.cwd())
    parser.add_argument("--target-repo-root", type=Path, help="Apply every accepted diff from this repository root.")
    parser.add_argument("--accept-key", action="append", default=[], help="Accepted proposal key to apply.")
    parser.add_argument(
        "--accepted-keys-file",
        type=Path,
        action="append",
        default=[],
        help="Text, JSON, or JSONL file listing accepted proposal keys.",
    )
    parser.add_argument("--dry-run", action="store_true", help="Validate and print actions without applying patches.")
    parser.add_argument("--branch", help="Create this branch before committing accepted edits.")
    parser.add_argument("--commit-message", default="Apply accepted Readest source edits")
    parser.add_argument("--create-pr", action="store_true", help="Push the branch and open a GitHub PR.")
    args = parser.parse_args()

    accepted_keys = merge_accepted_keys(args.accept_key, args.accepted_keys_file)
    records = iter_jsonl(args.input)
    proposals = select_accepted_proposals(
        records,
        accepted_keys,
        args.workspace_root.resolve(),
        args.target_repo_root.resolve() if args.target_repo_root else None,
    )
    if not proposals:
        raise SystemExit("no accepted proposals selected")

    grouped: dict[Path, list[AcceptedProposal]] = defaultdict(list)
    for proposal in proposals:
        grouped[proposal.target_root].append(proposal)

    for target_root, group in grouped.items():
        if args.branch and len(grouped) > 1:
            raise SystemExit("--branch currently requires all accepted proposals to target one repository")
        if args.branch and not args.dry_run:
            require_clean_worktree(target_root)
        apply_group(group, args.dry_run)
        if args.branch:
            body = "Accepted Readest source-edit proposals:\n\n" + "\n".join(f"- `{item.key}`" for item in group)
            create_branch_commit_and_pr(
                target_root,
                args.branch,
                args.commit_message,
                body,
                args.dry_run,
                args.create_pr,
            )

    print(json.dumps(summarize(proposals), indent=2, sort_keys=True))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
