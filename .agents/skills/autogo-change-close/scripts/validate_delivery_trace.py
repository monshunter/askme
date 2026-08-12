#!/usr/bin/env python3
"""Validate the document trace required before a Standard Plan closes."""
from __future__ import annotations

import argparse
import json
import re
import subprocess
from dataclasses import asdict, dataclass
from pathlib import Path

PLAN_ID_RE = re.compile(r"PLAN-\d+")
SCENARIO_ID_RE = re.compile(r"SCN-\d+")
EVOLUTION_ID_RE = re.compile(r"EVO-\d+")
BOUNDARY_ID_RE = re.compile(r"[a-z0-9]+(?:-[a-z0-9]+)*")
MARKDOWN_LINK_RE = re.compile(r"\[[^\]]+\]\(([^)]+\.md(?:#[^)]*)?)\)")
E2E_MARKER_RE = re.compile(
    r"(?:\bE2E\b|\bChrome\b|浏览器|\bsmoke\b|\bfrom-zero\b|\brestart\b|重启|生命周期|\blifecycle\b|部署后)",
    re.IGNORECASE,
)


@dataclass(frozen=True)
class Issue:
    severity: str
    code: str
    message: str
    path: str | None = None


@dataclass(frozen=True)
class DecisionRow:
    artifact_type: str
    boundary_id: str | None
    decision: str
    target: Path | None
    reason: str


@dataclass(frozen=True)
class ArtifactIdentity:
    boundary_id: str
    owner_boundary: str
    status: str


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.is_file() else ""


def relative(root: Path, path: Path) -> str:
    try:
        return path.relative_to(root).as_posix()
    except ValueError:
        return str(path)


def issue(mode: str, code: str, message: str, path: str | None = None) -> Issue:
    return Issue("error" if mode == "strict" else "warning", code, message, path)


def resolve_local_link(root: Path, source: Path, href: str) -> Path | None:
    target = href.split("#", 1)[0].strip().strip("<>")
    if not target or "://" in target or target.startswith("mailto:"):
        return None
    candidate = (source.parent / target).resolve()
    try:
        candidate.relative_to(root)
    except ValueError:
        return None
    return candidate


def linked_markdown(root: Path, source: Path, text: str, workspace: str) -> list[Path]:
    links: list[Path] = []
    for href in MARKDOWN_LINK_RE.findall(text):
        target = resolve_local_link(root, source, href)
        if target is not None and f"/{workspace}/" in f"/{relative(root, target)}":
            links.append(target)
    return links


def section(text: str, heading: str) -> str:
    match = re.search(
        rf"(?ims)^##\s+{re.escape(heading)}\s*$\n(.*?)(?=^##\s+|\Z)",
        text,
    )
    return match.group(1).strip() if match else ""


def field(text: str, name: str) -> str:
    match = re.search(rf"(?im)^{re.escape(name)}[：:]\s*(.+?)\s*$", text)
    return match.group(1).strip().strip("`") if match else ""


def plan_id(path: Path, text: str) -> str:
    match = PLAN_ID_RE.search(path.name) or PLAN_ID_RE.search(text)
    return match.group(0) if match else path.stem


def progress_plans(root: Path) -> list[Path]:
    progress = read(root / "PROGRESS.md")
    objectives = progress.split("## Objectives", 1)[1] if "## Objectives" in progress else progress
    plans: list[Path] = []
    for checked, href in re.findall(
        r"(?m)^- \[([xX])\] \[[^\]]*PLAN-\d+[^\]]*\]\(([^)]+\.md)\)\s*$",
        objectives,
    ):
        if checked.lower() != "x":
            continue
        target = resolve_local_link(root, root / "PROGRESS.md", href)
        if target is not None:
            plans.append(target)
    return plans


def matching_plan_reviews(root: Path, current_plan_id: str) -> list[Path]:
    reviews = root / "docs" / "reviews"
    if not reviews.is_dir():
        return []
    matches: list[Path] = []
    for path in sorted(reviews.glob("*.md")):
        text = read(path)
        if current_plan_id not in text or "Plan Review" not in text or not section(text, "Spec/Design decision matrix"):
            continue
        matches.append(path)
    return matches


def strip_cell(value: str) -> str:
    return value.strip().strip("`").strip()


def parse_decision_matrix(root: Path, review: Path, mode: str) -> tuple[list[DecisionRow], list[Issue]]:
    matrix = section(read(review), "Spec/Design decision matrix")
    review_path = relative(root, review)
    if not matrix:
        return [], [issue(mode, "DECISION_MATRIX_MISSING", "Plan Review has no Spec/Design decision matrix", review_path)]

    rows: list[DecisionRow] = []
    issues: list[Issue] = []
    seen: set[tuple[str, str]] = set()
    for line_number, line in enumerate(matrix.splitlines(), start=1):
        if not line.strip().startswith("|"):
            continue
        cells = [cell.strip() for cell in line.strip().strip("|").split("|")]
        if len(cells) != 5 or cells[0] == "Type" or all(re.fullmatch(r":?-+:?", cell) for cell in cells):
            continue
        artifact_type = strip_cell(cells[0])
        decision = strip_cell(cells[2])
        location = f"{review_path}:{line_number}"
        if artifact_type not in {"Spec", "Design"}:
            issues.append(issue(mode, "DECISION_TYPE_INVALID", f"unsupported artifact type: {artifact_type or 'empty'}", location))
            continue
        if decision not in {"CREATE", "UPDATE", "REFERENCE", "NOT_NEEDED"}:
            issues.append(issue(mode, "DECISION_INVALID", f"unsupported artifact decision: {decision or 'empty'}", location))
            continue

        boundary_cell = strip_cell(cells[1])
        target_cell = cells[3].strip()
        reason = re.sub(r"[`*_]", "", cells[4]).strip()
        if len(reason) < 8:
            issues.append(issue(mode, "DECISION_REASON_MISSING", f"{artifact_type} {decision} requires a concrete reason", location))

        boundary_id: str | None = None
        target: Path | None = None
        if decision == "NOT_NEEDED":
            if boundary_cell not in {"—", "-", "–"} or strip_cell(target_cell) not in {"—", "-", "–"}:
                issues.append(issue(mode, "NOT_NEEDED_TARGET_INVALID", "type-level NOT_NEEDED must use — for Boundary ID and Target", location))
            key = (artifact_type, "—")
        else:
            if not BOUNDARY_ID_RE.fullmatch(boundary_cell):
                issues.append(issue(mode, "BOUNDARY_ID_INVALID", f"invalid Boundary ID: {boundary_cell or 'empty'}", location))
            else:
                boundary_id = boundary_cell
            hrefs = MARKDOWN_LINK_RE.findall(target_cell)
            if len(hrefs) != 1:
                issues.append(issue(mode, "ARTIFACT_TARGET_INVALID", f"{artifact_type} {decision} must link exactly one Markdown Target", location))
            else:
                target = resolve_local_link(root, review, hrefs[0])
                if target is None:
                    issues.append(issue(mode, "ARTIFACT_TARGET_INVALID", "artifact Target must stay inside the project root", location))
            key = (artifact_type, boundary_cell)

        if key in seen:
            issues.append(issue(mode, "DECISION_DUPLICATE", f"duplicate decision for {artifact_type} {boundary_cell}", location))
        seen.add(key)
        rows.append(DecisionRow(artifact_type, boundary_id, decision, target, reason))

    for artifact_type in ("Spec", "Design"):
        type_rows = [row for row in rows if row.artifact_type == artifact_type]
        if not type_rows:
            issues.append(issue(mode, "DECISION_TYPE_MISSING", f"decision matrix has no {artifact_type} row", review_path))
        elif any(row.decision == "NOT_NEEDED" for row in type_rows) and len(type_rows) != 1:
            issues.append(issue(mode, "NOT_NEEDED_CONFLICT", f"{artifact_type} NOT_NEEDED cannot coexist with boundary decisions", review_path))
    return rows, issues


def parse_identity(text: str) -> ArtifactIdentity | None:
    boundary_id = field(text, "Boundary ID")
    owner_boundary = field(text, "Owner boundary")
    status = field(text, "Status")
    if not boundary_id and not owner_boundary and not status:
        return None
    return ArtifactIdentity(boundary_id, owner_boundary, status)


def canonical_artifact_type(root: Path, path: Path) -> str | None:
    rel = relative(root, path)
    name = path.name.upper()
    if path.name in {"README.md", "INDEX.md"}:
        return None
    if rel == "SPEC.md" or rel.startswith("docs/specs/") or rel.startswith("workflows/") or name.startswith("SPEC-"):
        return "Spec"
    if rel.startswith("docs/architecture/") or rel.startswith("docs/decisions/") or name.startswith(("DESIGN-", "ADR-")):
        return "Design"
    return None


def git_output(root: Path, *args: str) -> subprocess.CompletedProcess[str] | None:
    try:
        return subprocess.run(
            ["git", "-C", str(root), *args],
            check=False,
            capture_output=True,
            text=True,
        )
    except OSError:
        return None


def git_top(root: Path) -> Path | None:
    result = git_output(root, "rev-parse", "--show-toplevel")
    if result is None or result.returncode != 0:
        return None
    top = Path(result.stdout.strip()).resolve()
    try:
        root.relative_to(top)
    except ValueError:
        return None
    head = git_output(root, "rev-parse", "--verify", "HEAD")
    return top if head is not None and head.returncode == 0 else None


def git_target_state(root: Path, top: Path, target: Path) -> tuple[bool, bool]:
    target_from_top = target.relative_to(top).as_posix()
    baseline = git_output(top, "cat-file", "-e", f"HEAD:{target_from_top}")
    status = git_output(top, "status", "--porcelain=v1", "--untracked-files=all", "--", target_from_top)
    return bool(baseline is not None and baseline.returncode == 0), bool(status is not None and status.stdout.strip())


def changed_artifact_types(root: Path) -> set[str]:
    changed_paths: set[str] = set()
    for args in (
        ("diff", "--name-only", "-z", "HEAD", "--", "."),
        ("ls-files", "--others", "--exclude-standard", "-z", "--", "."),
    ):
        result = git_output(root, *args)
        if result is None or result.returncode != 0:
            return set()
        changed_paths.update(value for value in result.stdout.split("\0") if value)
    changed: set[str] = set()
    for value in changed_paths:
        artifact_type = canonical_artifact_type(root, (root / value).resolve())
        if artifact_type:
            changed.add(artifact_type)
    return changed


def validate_identity(root: Path, target: Path, row: DecisionRow, mode: str) -> tuple[ArtifactIdentity | None, list[Issue]]:
    target_path = relative(root, target)
    if not target.is_file():
        return None, [issue(mode, "ARTIFACT_TARGET_MISSING", f"artifact Target does not exist: {target_path}", target_path)]
    identity = parse_identity(read(target))
    if identity is None:
        return None, [issue(mode, "ARTIFACT_IDENTITY_MISSING", "Target must declare Boundary ID, Owner boundary, and Status", target_path)]

    issues: list[Issue] = []
    if not BOUNDARY_ID_RE.fullmatch(identity.boundary_id):
        issues.append(issue(mode, "ARTIFACT_BOUNDARY_INVALID", f"invalid Target Boundary ID: {identity.boundary_id or 'empty'}", target_path))
    elif identity.boundary_id != row.boundary_id:
        issues.append(issue(mode, "ARTIFACT_BOUNDARY_MISMATCH", f"matrix uses {row.boundary_id}, Target declares {identity.boundary_id}", target_path))
    if len(identity.owner_boundary) < 8:
        issues.append(issue(mode, "ARTIFACT_OWNER_MISSING", "Target must declare a concrete Owner boundary", target_path))
    if identity.status not in {"active", "superseded"}:
        issues.append(issue(mode, "ARTIFACT_STATUS_INVALID", "Target Status must be active or superseded", target_path))
    if row.decision in {"CREATE", "REFERENCE"} and identity.status != "active":
        issues.append(issue(mode, "ARTIFACT_NOT_ACTIVE", f"{row.decision} Target must be active", target_path))
    if identity.status == "superseded":
        superseded_by = field(read(target), "Superseded by")
        links = MARKDOWN_LINK_RE.findall(superseded_by)
        replacement = resolve_local_link(root, target, links[0]) if len(links) == 1 else None
        replacement_identity = parse_identity(read(replacement)) if replacement is not None else None
        if replacement is None or replacement_identity is None or replacement_identity.status != "active":
            issues.append(issue(mode, "SUPERSEDED_TARGET_INVALID", "superseded Target must link one active replacement with Superseded by", target_path))
    return identity, issues


def validate_artifact_decisions(root: Path, plan: Path, mode: str) -> list[Issue]:
    issues: list[Issue] = []
    plan_text = read(plan)
    current_plan_id = plan_id(plan, plan_text)
    plan_path = relative(root, plan)
    reviews = matching_plan_reviews(root, current_plan_id)
    if not reviews:
        issues.append(issue(mode, "DECISION_MATRIX_MISSING", f"{current_plan_id} has no Plan Review Spec/Design decision matrix", plan_path))
        return issues

    review = reviews[-1]
    rows, matrix_issues = parse_decision_matrix(root, review, mode)
    issues.extend(matrix_issues)
    top = git_top(root)
    if top is None:
        issues.append(issue(mode, "GIT_BASELINE_UNAVAILABLE", "cannot prove artifact decisions without a readable Git HEAD baseline", plan_path))
        return issues

    changed_types = changed_artifact_types(root)
    identities: dict[tuple[str, Path], ArtifactIdentity] = {}
    target_types: dict[Path, str] = {}
    for row in rows:
        if row.target is None:
            continue
        known_type = target_types.get(row.target)
        if known_type is not None and known_type != row.artifact_type:
            issues.append(issue(mode, "ARTIFACT_TARGET_TYPE_CONFLICT", "the same Target cannot be both Spec and Design", relative(root, row.target)))
        target_types[row.target] = row.artifact_type
    create_targets = {(row.artifact_type, row.target) for row in rows if row.decision == "CREATE" and row.target is not None}
    for row in rows:
        if row.decision == "NOT_NEEDED":
            if row.artifact_type in changed_types:
                issues.append(issue(mode, "NOT_NEEDED_DIFF_CONFLICT", f"{row.artifact_type} is NOT_NEEDED but the current Diff modifies a formal {row.artifact_type} document", relative(root, review)))
            continue
        if row.target is None:
            continue
        canonical_type = canonical_artifact_type(root, row.target)
        if canonical_type is not None and canonical_type != row.artifact_type:
            issues.append(issue(mode, "ARTIFACT_TYPE_MISMATCH", f"matrix declares {row.artifact_type}, but Target path is a canonical {canonical_type}", relative(root, row.target)))
        identity, identity_issues = validate_identity(root, row.target, row, mode)
        issues.extend(identity_issues)
        if identity is not None:
            identities[(row.artifact_type, row.target)] = identity
            if identity.status == "superseded":
                links = MARKDOWN_LINK_RE.findall(field(read(row.target), "Superseded by"))
                replacement = resolve_local_link(root, row.target, links[0]) if len(links) == 1 else None
                if (row.artifact_type, replacement) not in create_targets:
                    issues.append(issue(mode, "SUPERSEDED_REPLACEMENT_NOT_CREATED", "superseded UPDATE must link a same-type CREATE Target in the current matrix", relative(root, row.target)))

        try:
            baseline_exists, changed = git_target_state(root, top, row.target)
        except ValueError:
            issues.append(issue(mode, "ARTIFACT_TARGET_INVALID", "artifact Target is outside the Git worktree", relative(root, row.target)))
            continue
        target_path = relative(root, row.target)
        if row.decision == "CREATE" and (baseline_exists or not changed):
            issues.append(issue(mode, "CREATE_DIFF_MISMATCH", "CREATE Target must be new relative to HEAD and present in the current Diff", target_path))
        elif row.decision == "UPDATE" and (not baseline_exists or not changed):
            issues.append(issue(mode, "UPDATE_DIFF_MISMATCH", "UPDATE Target must exist in HEAD and be present in the current Diff", target_path))
        elif row.decision == "REFERENCE" and (not baseline_exists or changed):
            issues.append(issue(mode, "REFERENCE_DIFF_MISMATCH", "REFERENCE Target must exist in HEAD and remain unchanged", target_path))

    for path in root.rglob("*.md"):
        artifact_type = target_types.get(path.resolve()) or canonical_artifact_type(root, path)
        if artifact_type is None:
            continue
        identity = parse_identity(read(path))
        if identity is not None:
            identities[(artifact_type, path.resolve())] = identity

    active: dict[tuple[str, str], list[Path]] = {}
    for (artifact_type, path), identity in identities.items():
        if identity.status == "active" and BOUNDARY_ID_RE.fullmatch(identity.boundary_id):
            active.setdefault((artifact_type, identity.boundary_id), []).append(path)
    for (artifact_type, boundary_id), paths in sorted(active.items()):
        unique_paths = sorted(set(paths))
        if len(unique_paths) > 1:
            joined = ", ".join(relative(root, path) for path in unique_paths)
            issues.append(issue(mode, "ACTIVE_OWNER_DUPLICATE", f"{artifact_type} {boundary_id} has multiple active owners: {joined}", relative(root, review)))

    return issues


def validate_scenarios(root: Path, plan: Path, mode: str) -> list[Issue]:
    issues: list[Issue] = []
    for line_number, line in enumerate(read(plan).splitlines(), start=1):
        if not re.match(r"^- \[[ xX]\] \d+\.\d+ ", line) or not E2E_MARKER_RE.search(line):
            continue
        scenario_links = linked_markdown(root, plan, line, "docs/scenarios")
        if not SCENARIO_ID_RE.search(line) or not scenario_links:
            issues.append(issue(mode, "SCENARIO_LINK_MISSING", "real E2E/Chrome/smoke/lifecycle Plan item must link an SCN-* document", f"{relative(root, plan)}:{line_number}"))
            continue
        for scenario in scenario_links:
            if not scenario.is_file():
                issues.append(issue(mode, "SCENARIO_LINK_BROKEN", f"linked Scenario does not exist: {relative(root, scenario)}", f"{relative(root, plan)}:{line_number}"))
            elif not SCENARIO_ID_RE.search(read(scenario)):
                issues.append(issue(mode, "SCENARIO_ID_MISSING", f"linked Scenario has no SCN-* ID: {relative(root, scenario)}", relative(root, scenario)))
    return issues


def delivery_journals(root: Path, current_plan_id: str) -> list[Path]:
    journal_root = root / "docs" / "journal"
    if not journal_root.is_dir():
        return []
    matches: list[Path] = []
    for path in sorted(journal_root.glob("*.md")):
        if path.name in {"README.md", "INDEX.md"}:
            continue
        text = read(path)
        journal_plan = PLAN_ID_RE.search(field(text, "Plan"))
        if (
            journal_plan is not None
            and journal_plan.group(0) == current_plan_id
            and re.search(r"(?im)^记录类型[：:]\s*delivery\s*$", text)
        ):
            matches.append(path)
    return matches


def validate_journal(root: Path, plan: Path, mode: str) -> list[Issue]:
    current_plan_id = plan_id(plan, read(plan))
    journals = delivery_journals(root, current_plan_id)
    if not journals:
        return [issue(mode, "JOURNAL_DELIVERY_MISSING", f"{current_plan_id} has no delivery Journal record", relative(root, plan))]

    issues: list[Issue] = []
    journal = journals[-1]
    journal_text = read(journal)
    result_line = re.search(r"(?im)^Session Review[：:]\s*(.+)$", journal_text)
    if not result_line:
        issues.append(issue(mode, "SESSION_REVIEW_MISSING", f"{current_plan_id} Journal has no Session Review result", relative(root, journal)))
        return issues
    result = result_line.group(1)
    if "NO_EVOLUTION" in result:
        return issues
    evolution_links = linked_markdown(root, journal, result, "docs/harness/evolution")
    if not EVOLUTION_ID_RE.search(result) or not evolution_links:
        issues.append(issue(mode, "SESSION_REVIEW_INVALID", "Session Review must record NO_EVOLUTION or link an EVO-* document", relative(root, journal)))
        return issues
    for evolution in evolution_links:
        if not evolution.is_file():
            issues.append(issue(mode, "EVOLUTION_LINK_BROKEN", f"linked Evolution does not exist: {relative(root, evolution)}", relative(root, journal)))
        elif not re.search(r"(?m)^Session Review 结果[：:]\s*`?(?:OBSERVATION|CANDIDATE|PROPOSAL)`?\s*$", read(evolution)):
            issues.append(issue(mode, "EVOLUTION_RESULT_INVALID", f"linked Evolution has no fixed Session Review result: {relative(root, evolution)}", relative(root, evolution)))
    return issues


def validate_indexes(root: Path, mode: str) -> list[Issue]:
    issues: list[Issue] = []
    for workspace in (Path("docs/specs"), Path("docs/architecture"), Path("docs/scenarios"), Path("docs/journal"), Path("docs/harness/evolution")):
        directory = root / workspace
        if not directory.is_dir():
            continue
        bodies = {path.resolve() for path in directory.glob("*.md") if path.name not in {"README.md", "INDEX.md"}}
        if not bodies:
            continue
        index = directory / "INDEX.md"
        if not index.is_file():
            issues.append(issue(mode, "INDEX_MISSING", f"{workspace.as_posix()} has documents but no INDEX.md", relative(root, directory)))
            continue
        linked = {
            target
            for href in MARKDOWN_LINK_RE.findall(read(index))
            if (target := resolve_local_link(root, index, href)) is not None and target.parent == directory.resolve()
        }
        for missing in sorted(bodies - linked):
            issues.append(issue(mode, "INDEX_ENTRY_MISSING", f"INDEX.md does not link {missing.name}", relative(root, index)))
        for broken in sorted(linked - bodies):
            if broken.name not in {"README.md", "INDEX.md"}:
                issues.append(issue(mode, "INDEX_LINK_BROKEN", f"INDEX.md links missing document {broken.name}", relative(root, index)))
    return issues


def validate_plan(root: Path, plan: Path, mode: str) -> list[Issue]:
    if not plan.is_file():
        return [issue(mode, "PLAN_MISSING", f"Plan does not exist: {relative(root, plan)}", relative(root, plan))]
    return validate_artifact_decisions(root, plan, mode) + validate_scenarios(root, plan, mode) + validate_journal(root, plan, mode)


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Standard delivery trace before close")
    parser.add_argument("--root", default=".", help="Project root")
    parser.add_argument("--mode", choices=("audit", "strict"), required=True)
    parser.add_argument("--plan", help="Plan path relative to the project root")
    parser.add_argument("--json", action="store_true", help="Print a JSON report")
    args = parser.parse_args()

    root = Path(args.root).expanduser().resolve()
    if args.plan:
        plan = (root / args.plan).resolve()
        try:
            plan.relative_to(root)
        except ValueError:
            parser.error("--plan must stay inside --root")
        plans = [plan]
    elif args.mode == "strict":
        parser.error("--plan is required in strict mode")
    else:
        plans = progress_plans(root)

    issues: list[Issue] = []
    for plan in plans:
        issues.extend(validate_plan(root, plan, args.mode))
    issues.extend(validate_indexes(root, args.mode))

    errors = sum(item.severity == "error" for item in issues)
    warnings = sum(item.severity == "warning" for item in issues)
    if args.json:
        print(json.dumps({"mode": args.mode, "plans": [relative(root, plan) for plan in plans], "issues": [asdict(item) for item in issues], "errors": errors, "warnings": warnings}, ensure_ascii=False, indent=2))
    else:
        for item in issues:
            location = f" [{item.path}]" if item.path else ""
            print(f"{item.severity.upper()} {item.code}{location}: {item.message}")
        print(f"delivery trace: {errors} errors, {warnings} warnings, {len(plans)} plans")
    return 1 if errors else 0


if __name__ == "__main__":
    raise SystemExit(main())
