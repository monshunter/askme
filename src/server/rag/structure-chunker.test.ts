import { describe, expect, it } from "vitest";

import { loadConfigFromSources } from "@/server/config";

import { structureChunkText } from "./structure-chunker";

const chunking = loadConfigFromSources({}, "").rag.chunking;

describe("structure-first Parent-Child chunking", () => {
  it("keeps a resume company, role and responsibilities inside one Parent", () => {
    const text = [
      "# 工作经历",
      "",
      "## 富途控股｜后台研发工程师｜2021-2024",
      "",
      "负责 Kubernetes 服务发现、命名服务与稳定性建设。",
      "",
      "将核心链路故障恢复时间从 30 分钟降至 5 分钟，并建立灰度和回滚机制。",
      "",
      "## 其他公司｜研发工程师｜2019-2021",
      "",
      "负责独立业务系统。",
    ].join("\n");

    const result = structureChunkText({ text, sourceRevision: "resume-v1", sourceTitle: "候选人简历", config: chunking });
    const futuParent = result.parents.find((parent) => parent.content.includes("富途控股"));

    expect(futuParent?.content).toContain("后台研发工程师");
    expect(futuParent?.content).toContain("Kubernetes 服务发现");
    expect(futuParent?.content).toContain("故障恢复时间");
    expect(futuParent?.structurePath).toContain("富途控股");
  });

  it("bounds forced Child splits and uses overlap only for oversized structural units", () => {
    const oversized = `# 长章节\n\n${Array.from({ length: 1_600 }, (_, index) => `事实${index}`).join("，")}`;
    const result = structureChunkText({ text: oversized, sourceRevision: "long-v1", sourceTitle: "长文档", config: chunking });

    expect(result.children.length).toBeGreaterThan(2);
    expect(result.children.every((child) => child.tokenCount <= chunking.childHardMaxTokens)).toBe(true);
    expect(result.children.slice(0, -1).every((child) => child.tokenCount >= chunking.childMinTokens)).toBe(true);
    expect(result.children.some((child) => child.sourceRange.forcedSplit === true)).toBe(true);
  });

  it("generates stable content identities from revision, structure, range and checksum", () => {
    const input = { text: "# 项目\n\nAskme 使用授权证据回答问题。", sourceRevision: "revision-a", sourceTitle: "项目材料", config: chunking };
    const first = structureChunkText(input);
    const second = structureChunkText(input);
    const changedRevision = structureChunkText({ ...input, sourceRevision: "revision-b" });

    expect(first).toEqual(second);
    expect(first.parents[0]?.stableKey).toMatch(/^[0-9a-f]{64}$/);
    expect(first.children[0]?.contentChecksum).toMatch(/^[0-9a-f]{64}$/);
    expect(changedRevision.parents[0]?.stableKey).not.toBe(first.parents[0]?.stableKey);
  });

  it("adds contextual source and section text only to Embedding input", () => {
    const result = structureChunkText({
      text: "# Skills\n\nGo、Kubernetes、RAG。",
      sourceRevision: "skills-v1",
      sourceTitle: "Resume",
      entityLabels: ["Askme", "RAG"],
      config: chunking,
    });
    const child = result.children[0];

    expect(child?.contextualContent).toContain("Source: Resume");
    expect(child?.contextualContent).toContain("Entities: Askme | RAG");
    expect(child?.contextualContent).toContain("Section: Skills");
    expect(child?.content).not.toContain("Source: Resume");
    expect(child?.content).not.toContain("Entities: Askme");
  });
});
