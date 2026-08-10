export type DashboardFacts = {
  materialTotal: number;
  queuedCount: number;
  processingCount: number;
  indexedCount: number;
  failedCount: number;
  knowledgeTotal: number;
  citationReadyCount: number;
  publicationStatus: "draft" | "published" | "revoked" | "paused" | null;
  aiConfigured: boolean;
  workerFresh: boolean;
};

export function deriveDashboardState(facts: DashboardFacts) {
  const citationRatio = facts.knowledgeTotal === 0 ? 0 : Math.round((facts.citationReadyCount / facts.knowledgeTotal) * 100);
  const agentStatus = facts.publicationStatus ?? (facts.knowledgeTotal > 0 ? "draft" : "not_ready");
  const workflow = [
    { id: "materials", status: facts.materialTotal > 0 ? "completed" : "not_started" },
    {
      id: "knowledge",
      status: facts.knowledgeTotal > 0 ? "completed" : facts.queuedCount + facts.processingCount > 0 ? "in_progress" : facts.failedCount > 0 ? "needs_attention" : "not_started",
    },
    { id: "agent", status: facts.publicationStatus === "published" ? "completed" : facts.knowledgeTotal > 0 ? "available" : "locked" },
    { id: "interviewer_chat", status: facts.publicationStatus === "published" ? "available" : "locked" },
  ];
  const nextActions: string[] = [];
  if (facts.failedCount > 0) nextActions.push("review_failed_materials");
  if (facts.materialTotal === 0) nextActions.push("upload_materials");
  else if (facts.queuedCount + facts.processingCount > 0) nextActions.push("wait_for_processing");
  if (facts.knowledgeTotal > 0 && facts.citationReadyCount === 0) nextActions.push("configure_privacy");
  if (facts.knowledgeTotal > 0 && facts.publicationStatus !== "published") nextActions.push("preview_agent");
  if (!facts.aiConfigured) nextActions.unshift("configure_ai");
  return { citationRatio, agentStatus, workflow, nextActions };
}
