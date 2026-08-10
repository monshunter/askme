import { describe, expect, it } from "vitest";

import { deriveDashboardState } from "./dashboard-state";

describe("Candidate dashboard state", () => {
  it("keeps empty, processing, failed, and ready states distinct", () => {
    expect(
      deriveDashboardState({
        materialTotal: 0,
        queuedCount: 0,
        processingCount: 0,
        indexedCount: 0,
        failedCount: 0,
        knowledgeTotal: 0,
        citationReadyCount: 0,
        publicationStatus: null,
        aiConfigured: true,
        workerFresh: true,
      }),
    ).toMatchObject({ agentStatus: "not_ready", nextActions: ["upload_materials"] });
    expect(
      deriveDashboardState({
        materialTotal: 1,
        queuedCount: 1,
        processingCount: 0,
        indexedCount: 0,
        failedCount: 0,
        knowledgeTotal: 0,
        citationReadyCount: 0,
        publicationStatus: null,
        aiConfigured: true,
        workerFresh: true,
      }).workflow[1],
    ).toEqual({ id: "knowledge", status: "in_progress" });
    expect(
      deriveDashboardState({
        materialTotal: 1,
        queuedCount: 0,
        processingCount: 0,
        indexedCount: 0,
        failedCount: 1,
        knowledgeTotal: 0,
        citationReadyCount: 0,
        publicationStatus: null,
        aiConfigured: true,
        workerFresh: true,
      }).workflow[1],
    ).toEqual({ id: "knowledge", status: "needs_attention" });
  });

  it("derives real citation ratio and publication state", () => {
    expect(
      deriveDashboardState({
        materialTotal: 3,
        queuedCount: 0,
        processingCount: 0,
        indexedCount: 3,
        failedCount: 0,
        knowledgeTotal: 8,
        citationReadyCount: 6,
        publicationStatus: "published",
        aiConfigured: true,
        workerFresh: true,
      }),
    ).toMatchObject({ citationRatio: 75, agentStatus: "published", nextActions: [] });
  });
});
