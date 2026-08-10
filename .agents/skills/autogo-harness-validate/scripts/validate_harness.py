#!/usr/bin/env python3
"""Validate Harness structure for the autogo-harness-validate Skill.

The validator checks structure and published workflow semantics. It never
chooses a route, creates work items, or changes project state.
"""
from __future__ import annotations

import argparse
import json
import re
from dataclasses import dataclass, asdict
from pathlib import Path

AGENT_DIR = ".agents"
INSTRUCTIONS_FILE = "AGENTS.md"
AUTOGO_DIR = ".autogo"
ROOT_BEGIN = "<!-- AGENT-HARNESS:BEGIN ROOT-CONTRACT -->"
ROOT_END = "<!-- AGENT-HARNESS:END ROOT-CONTRACT -->"
DOCS_BEGIN = "<!-- AGENT-HARNESS:BEGIN DOCS-CONTRACT -->"
DOCS_README_BEGIN = "<!-- AGENT-HARNESS:BEGIN DOCS-README -->"
REQUIRED_SKILL_SECTIONS = {
    "## 目标",
    "## 输入与发现",
    "## 输出与持久制品",
    "## 副作用与 Human Gate",
    "## 执行步骤",
    "## 验证与完成",
    "## 失败、重试与幂等",
}
EXPECTED_SKILLS = {
    "autogo-change-intake", "autogo-work-continue", "autogo-investigate", "autogo-spec-write", "autogo-spec-review",
    "autogo-solution-design", "autogo-design-review", "autogo-plan-write", "autogo-plan-review", "autogo-change-implement",
    "autogo-tdd", "autogo-change-review", "autogo-e2e-run", "autogo-env-manage", "autogo-deploy", "autogo-change-close",
    "autogo-bug-report", "autogo-rally", "autogo-doc-index", "autogo-instruction-resolve", "autogo-session-review",
    "autogo-harness-init", "autogo-harness-validate", "autogo-harness-evolve",
}
LIFECYCLE_SKILLS = {
    "autogo-harness-init", "autogo-change-intake", "autogo-work-continue", "autogo-investigate",
    "autogo-spec-write", "autogo-spec-review", "autogo-solution-design", "autogo-design-review",
    "autogo-plan-write", "autogo-plan-review", "autogo-change-implement", "autogo-tdd",
    "autogo-change-review", "autogo-env-manage", "autogo-e2e-run", "autogo-deploy", "autogo-change-close",
}
SKILL_NAME_RE = re.compile(r"^[a-z0-9]+(?:-[a-z0-9]+)*$")
REQUIRED_DOC_WORKSPACES = {
    "architecture", "bugs", "decisions", "harness/evolution", "journal",
    "operations", "plans", "reviews", "scenarios", "specs",
}
ROOT_WORKFLOW_MARKERS = (
    "Fast = 明确 AND 局部 AND 可逆 AND 可验",
    "不创建 Objective、正式 Plan 或正式 Review",
    "## 5. Standard 主循环与 Skill 路由",
    "Observe → Understand → Decide → Act → Verify → Reconcile → Close",
    "autogo-change-intake<br/>Objective / Scope",
    "autogo-plan-write<br/>至少一份正式 Plan",
    "按 description 与当前事实调用所需能力",
    "autogo-change-review",
    "Reconcile 到对应 owner",
    "autogo-deploy<br/>预检 / Human Gate / 部署后验证",
    "autogo-change-close",
    "从最近仍然必要的 Plan Review",
    "第一条 Phase Item",
    "Plan Review",
    "Change Review",
    "Reconcile",
    "PASS_WITH_NOTES",
    "Waiting",
    "Cancelled",
    "push right",
    "自动选择同一 Objective 的下一未完成 Plan",
    "一个单一工程意图的原子 Commit",
    "Fast 不创建 Objective",
)
SKILL_WORKFLOW_MARKERS = {
    "autogo-change-intake": (
        "纯回答、Review-only、Diagnose-only",
        "Fast 也不调用本 Skill",
        "至少一份正式 Plan",
        "第一条 Phase Item",
    ),
    "autogo-plan-write": (
        "不能把正式 Plan 视为可选",
        "Review 通过前不执行第一条 Item",
    ),
    "autogo-plan-review": (
        "才允许执行第一条 Item",
        "实质调整后必须重新审查",
    ),
    "autogo-change-implement": (
        "Fast 未创建 Objective、Plan 或 Review",
        "Standard 的 Progress 与正式制品事实一致",
        "Fast 默认不创建任何生命周期制品",
    ),
    "autogo-change-review": (
        "进入 Reconcile",
        "不因普通失败自动回滚",
        "standalone Review-only",
        "项目状态也完全只读",
    ),
    "autogo-work-continue": (
        "唯一事实 owner",
        "最近一次 Plan Review",
        "存在下一 Plan 时立即继续",
    ),
    "autogo-change-close": (
        "下一未完成 Plan",
        "Waiting",
        "Cancelled",
        "原子 Commit",
        "Fast 直接按根合同对账",
    ),
    "autogo-investigate": ("独立只读调查", "没有则交付发现"),
    "autogo-deploy": ("普通失败不自动回滚", "真实状态受损"),
}


@dataclass
class Issue:
    severity: str
    code: str
    message: str
    path: str | None = None


def read(path: Path) -> str:
    return path.read_text(encoding="utf-8") if path.exists() else ""


def parse_scalar_front_matter(text: str) -> dict[str, str]:
    if not text.startswith("---\n"):
        return {}
    end = text.find("\n---\n", 4)
    if end < 0:
        return {}
    result: dict[str, str] = {}
    for line in text[4:end].splitlines():
        if line and not line[0].isspace() and ":" in line:
            key, value = line.split(":", 1)
            result[key.strip()] = value.strip().strip("\"'")
    return result


def managed_block(text: str, begin: str, end: str) -> str:
    start = text.find(begin)
    finish = text.find(end)
    if start < 0 or finish < start:
        return ""
    return text[start + len(begin):finish]


def validate(root: Path) -> list[Issue]:
    issues: list[Issue] = []
    instructions = root / INSTRUCTIONS_FILE
    if not instructions.exists():
        issues.append(Issue("error", "ROOT_INSTRUCTIONS_MISSING", f"{INSTRUCTIONS_FILE} is missing", INSTRUCTIONS_FILE))
    else:
        root_text = read(instructions)
        root_contract = managed_block(root_text, ROOT_BEGIN, ROOT_END)
        if not root_contract:
            issues.append(Issue("error", "ROOT_BLOCK_MISSING", "Harness root contract block is missing", INSTRUCTIONS_FILE))
        for marker in ROOT_WORKFLOW_MARKERS:
            if marker not in root_contract:
                issues.append(Issue("error", "ROOT_LIFECYCLE", f"Harness root lifecycle marker is missing: {marker}", INSTRUCTIONS_FILE))
        if re.search(r"\bR[0-3]\b", root_contract):
            issues.append(Issue("error", "ROOT_RETIRED_RISK", "Harness root contract retains a retired numbered risk level", INSTRUCTIONS_FILE))
        for retired in ("需要正式 Plan 时", "正式 Plan 存在时", "失败立即回滚", "需要正式 Plan?", "回写结果 / Evidence / PROGRESS.md"):
            if retired in root_contract:
                issues.append(Issue("error", "ROOT_RETIRED_WORKFLOW", f"Harness root contract retains retired workflow semantics: {retired}", INSTRUCTIONS_FILE))

    skills_root = root / AGENT_DIR / "skills"
    agent_root = root / AGENT_DIR
    if agent_root.exists():
        unexpected = sorted(path.name for path in agent_root.iterdir() if path.name != "skills")
        for name in unexpected:
            issues.append(Issue("error", "AGENT_ROOT_LAYOUT", "Agent native directory may only contain skills/", f"{AGENT_DIR}/{name}"))
    found = {p.parent.name for p in skills_root.glob("*/SKILL.md")} if skills_root.exists() else set()
    for missing in sorted(EXPECTED_SKILLS - found):
        relative = f"{AGENT_DIR}/skills/{missing}/SKILL.md"
        issues.append(Issue("error", "SKILL_MISSING", f"required skill is missing: {missing}", relative))
    for skill_file in sorted(skills_root.glob("*/SKILL.md")) if skills_root.exists() else []:
        text = read(skill_file)
        meta = parse_scalar_front_matter(text)
        skill_name = meta.get("name", "")
        if skill_name != skill_file.parent.name:
            issues.append(Issue("error", "SKILL_NAME", "front matter name does not match directory", str(skill_file.relative_to(root))))
        if not 1 <= len(skill_name) <= 64 or not SKILL_NAME_RE.fullmatch(skill_name):
            issues.append(Issue("error", "SKILL_NAME_FORMAT", "front matter name must follow the Agent Skills naming rules", str(skill_file.relative_to(root))))
        description = meta.get("description", "")
        if not description:
            issues.append(Issue("error", "SKILL_DESCRIPTION", "front matter description is required for skill discovery", str(skill_file.relative_to(root))))
        elif not re.search(r"(?:时|前|后)使用", description):
            issues.append(Issue("error", "SKILL_DESCRIPTION_CONTEXT", "front matter description must state when to use the Skill", str(skill_file.relative_to(root))))
        if "## 触发条件" in text:
            issues.append(Issue("error", "SKILL_TRIGGER_SECTION", "usage conditions must live in front matter description, not the post-trigger body", str(skill_file.relative_to(root))))
        for section in sorted(REQUIRED_SKILL_SECTIONS):
            if section not in text:
                issues.append(Issue("error", "SKILL_SECTION", f"missing section: {section}", str(skill_file.relative_to(root))))
        if skill_name in LIFECYCLE_SKILLS and "Progress" not in text:
            issues.append(Issue("error", "SKILL_LIFECYCLE", "lifecycle skill does not read or write Progress", str(skill_file.relative_to(root))))
        for marker in SKILL_WORKFLOW_MARKERS.get(skill_name, ()):
            if marker not in text:
                issues.append(Issue("error", "SKILL_WORKFLOW", f"skill workflow marker is missing: {marker}", str(skill_file.relative_to(root))))
        if re.search(r"\bR[0-3]\b", text):
            issues.append(Issue("error", "SKILL_RETIRED_RISK", "skill retains a retired numbered risk level", str(skill_file.relative_to(root))))
        for retired in ("需要正式 Plan 时", "正式 Plan 存在时", "失败立即回滚"):
            if retired in text:
                issues.append(Issue("error", "SKILL_RETIRED_WORKFLOW", f"skill retains retired workflow semantics: {retired}", str(skill_file.relative_to(root))))
        forbidden = [r"\./harness\s+work", r"\./harness\s+doc", r"\./harness\s+component"]
        if any(re.search(pattern, text) for pattern in forbidden):
            issues.append(Issue("error", "USER_CRUD", "skill references a user-facing Harness CRUD command", str(skill_file.relative_to(root))))

    internal = root / AGENT_DIR / "internal"
    if internal.exists():
        issues.append(Issue("error", "SHARED_INTERNAL", "Skill resources must not use a shared internal directory", str(internal.relative_to(root))))
    for script in sorted(agent_root.rglob("*.py")) if agent_root.exists() else []:
        relative = script.relative_to(root)
        parts = relative.parts
        if len(parts) < 5 or parts[1] != "skills" or parts[3] != "scripts":
            issues.append(Issue("error", "SKILL_SCRIPT_OWNER", "Python script is not contained by its owning Skill scripts directory", str(relative)))
            continue
        skill_file = root / parts[0] / "skills" / parts[2] / "SKILL.md"
        if not skill_file.is_file() or relative.as_posix() not in read(skill_file):
            issues.append(Issue("error", "SKILL_SCRIPT_REFERENCE", "owning Skill does not reference its bundled script", str(relative)))

    required_examples = {
        f"{AUTOGO_DIR}/templates/component/component-agent-contract.md": ("## 1. 组件职责", "## 8. 完成标准"),
        f"{AUTOGO_DIR}/templates/documents/adr.md": ("## 背景", "## 决策", "## 影响"),
        f"{AUTOGO_DIR}/templates/documents/bug.md": ("## 现象与影响", "## 根因与促成因素", "## 验证证据"),
        f"{AUTOGO_DIR}/templates/documents/design.md": ("## 上下文与目标", "## 方案与权衡", "## 验证计划"),
        f"{AUTOGO_DIR}/templates/documents/evolution.md": ("## 证据与出现次数", "## 复杂度变化", "## 回滚"),
        f"{AUTOGO_DIR}/templates/documents/journal.md": ("## 本次实际完成", "## 当前证据", "## 下一恢复点"),
        f"{AUTOGO_DIR}/templates/documents/operation.md": ("## 执行前检查", "## 恢复方案", "## 证据记录"),
        f"{AUTOGO_DIR}/templates/documents/plan.md": ("## 目标与范围", "## Phase 1：", "- [ ] 1.1 ", "## Phase 3："),
        f"{AUTOGO_DIR}/templates/documents/review.md": ("## 审查范围", "## 结论", "## 必需的后续行动"),
        f"{AUTOGO_DIR}/templates/documents/scenario.md": ("## 前置状态", "## 操作步骤", "## 预期结果"),
        f"{AUTOGO_DIR}/templates/documents/spec.md": ("父 Plan：", "## 验收标准", "AC-001"),
        f"{AUTOGO_DIR}/templates/project/project-context.md": ("### 1. 项目使命与当前阶段", "### 7. 项目特有完成标准"),
    }
    for relative, markers in required_examples.items():
        example = root / relative
        example_text = read(example)
        if not example.exists():
            issues.append(Issue("error", "REFERENCE_EXAMPLE_MISSING", "required reference example is missing", relative))
            continue
        if example_text.startswith("---\n"):
            issues.append(Issue("error", "REFERENCE_EXAMPLE_FRONT_MATTER", "reference example must not start with YAML Front Matter", relative))
        if re.search(r"\{\{[^{}]+\}\}", example_text):
            issues.append(Issue("error", "REFERENCE_EXAMPLE_VARIABLE", "reference example contains a template variable", relative))
        for marker in markers:
            if marker not in example_text:
                issues.append(Issue("error", "REFERENCE_EXAMPLE_INCOMPLETE", f"reference example marker is missing: {marker}", relative))

    plan_example = root / AUTOGO_DIR / "templates" / "documents" / "plan.md"
    plan_text = read(plan_example)
    for forbidden in ("## 子 Spec 与依赖", "## 执行步骤", "## 核对清单", "PLAN-ITEM", "Evidence", "恢复点", "Checkpoint", "Done When", "失败处理", "逐项回滚"):
        if forbidden in plan_text:
            issues.append(Issue("error", "REFERENCE_PLAN_OVERDESIGNED", f"Plan example contains retired execution-control content: {forbidden}", str(plan_example.relative_to(root))))

    template_root = root / AUTOGO_DIR / "templates"
    for obsolete in sorted(template_root.rglob("*.tmpl")) if template_root.exists() else []:
        issues.append(Issue("error", "OBSOLETE_TEMPLATE_FILE", "reference examples must not use the .tmpl suffix", str(obsolete.relative_to(root))))

    progress = root / "PROGRESS.md"
    if not progress.is_file():
        issues.append(Issue("error", "PROGRESS_MISSING", "root PROGRESS.md is required after installation", "PROGRESS.md"))
    else:
        progress_text = read(progress)
        progress_markers = (
            "## 使用规则", "## 格式样例", "## Objectives",
            "ID: OBJ-001", "Objective: 完成示例功能", "Status: 正在处理", "Plans:",
            "- [x] [PLAN-001：完成基础实现](docs/plans/PLAN-001.md)",
            "- [ ] [PLAN-002：完成验证与收口](docs/plans/PLAN-002.md)",
            "`还没开始`", "`正在处理`", "`已完成`",
        )
        for marker in progress_markers:
            if marker not in progress_text:
                issues.append(Issue("error", "PROGRESS_CONTRACT", f"root Progress marker is missing: {marker}", "PROGRESS.md"))
        ordered_sections = ("## 使用规则", "## 格式样例", "## Objectives")
        if not all(progress_text.find(left) < progress_text.find(right) for left, right in zip(ordered_sections, ordered_sections[1:])):
            issues.append(Issue("error", "PROGRESS_ORDER", "usage rules and example must appear before Objectives", "PROGRESS.md"))
        for marker in ("## Plans", "| ID | Objective", "| ID | Objective | Plan", "## Specs", "## Blockers", "## Evidence", "Current Spec", "Spec IDs", "AC / Evidence", "Next Action", "Human Gate"):
            if marker in progress_text:
                issues.append(Issue("error", "PROGRESS_DETAIL", f"root Progress contains Plan-internal detail: {marker}", "PROGRESS.md"))
    duplicate_progress = root / AUTOGO_DIR / "templates" / "project" / "PROGRESS.md"
    if duplicate_progress.exists():
        issues.append(Issue("error", "DUPLICATE_PROGRESS", "legacy Progress reference would create a second state shape", str(duplicate_progress.relative_to(root))))

    docs = root / "docs"
    if not docs.exists():
        issues.append(Issue("error", "DOCS_MISSING", "docs workspace root is missing", "docs"))
    else:
        docs_instructions = docs / INSTRUCTIONS_FILE
        if not docs_instructions.is_file():
            issues.append(Issue("error", "DOCS_INSTRUCTIONS_MISSING", f"docs {INSTRUCTIONS_FILE} is missing", str(docs_instructions.relative_to(root))))
        elif DOCS_BEGIN not in read(docs_instructions):
            issues.append(Issue("error", "DOCS_BLOCK_MISSING", f"docs {INSTRUCTIONS_FILE} lacks the Harness docs contract block", str(docs_instructions.relative_to(root))))
        docs_readme = docs / "README.md"
        if not docs_readme.is_file():
            issues.append(Issue("error", "DOCS_README_MISSING", "docs README.md is missing", str(docs_readme.relative_to(root))))
        elif DOCS_README_BEGIN not in read(docs_readme):
            issues.append(Issue("error", "DOCS_README_BLOCK_MISSING", "docs README.md lacks the Harness docs block", str(docs_readme.relative_to(root))))
        for relative in sorted(REQUIRED_DOC_WORKSPACES):
            workspace = docs / relative
            if not workspace.is_dir():
                issues.append(Issue("error", "WORKSPACE_MISSING", "required docs workspace is missing", str(workspace.relative_to(root))))
                continue
            for required in ("README.md", "INDEX.md"):
                path = workspace / required
                if not path.is_file():
                    issues.append(Issue("error", "WORKSPACE_META_MISSING", f"required docs workspace file is missing: {required}", str(path.relative_to(root))))
        for directory in sorted(p for p in docs.rglob("*") if p.is_dir()):
            excluded = {"README.md", "INDEX.md", INSTRUCTIONS_FILE}
            docs_here = [p for p in directory.glob("*.md") if p.name not in excluded]
            if docs_here:
                for required in ("README.md", "INDEX.md"):
                    if not (directory / required).exists():
                        issues.append(Issue("warning", "WORKSPACE_META", f"active docs workspace lacks {required}", str(directory.relative_to(root))))

    legacy_wrapper = root / "harness"
    if legacy_wrapper.exists() and ".harness/runtime/harness_cli.py" in read(legacy_wrapper):
        issues.append(Issue("warning", "LEGACY_RUNTIME", "legacy project-root ./harness control plane remains", "harness"))
    if (root / ".harness" / "runtime" / "harness_cli.py").exists():
        issues.append(Issue("warning", "LEGACY_RUNTIME", "legacy .harness runtime remains", ".harness/runtime/harness_cli.py"))

    return issues


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate Native-Agent-First Harness structure")
    parser.add_argument("--root", default=".")
    parser.add_argument("--strict", action="store_true", help="Treat warnings as failures")
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    root = Path(args.root).expanduser().resolve()
    issues = validate(root)
    errors = sum(i.severity == "error" for i in issues)
    warnings = sum(i.severity == "warning" for i in issues)
    if args.json:
        print(json.dumps({"errors": errors, "warnings": warnings, "issues": [asdict(i) for i in issues]}, ensure_ascii=False, indent=2))
    else:
        for issue in issues:
            location = f" [{issue.path}]" if issue.path else ""
            print(f"{issue.severity.upper()} {issue.code}{location}: {issue.message}")
        print(f"Harness validation: {errors} errors, {warnings} warnings")
    return 1 if errors or (args.strict and warnings) else 0


if __name__ == "__main__":
    raise SystemExit(main())
