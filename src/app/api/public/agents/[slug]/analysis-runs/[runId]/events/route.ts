import type { NextRequest } from "next/server";

import { analysisRunSseResponse, type AnalysisRunSnapshot } from "@/server/code-agent/analysis-sse";
import { getPool } from "@/server/db/client";
import { apiFailure, requestId, withRequestId } from "@/server/http";
import { requirePublicConversation } from "@/server/public-chat/session-service";
import { requestVisitorToken } from "@/server/public-chat/visitor-credential";
import { parsePublicSlug } from "@/server/publication/publication-policy";
import { requireResourceId } from "@/server/resource-id";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest, context: { params: Promise<{ slug: string; runId: string }> }) {
  const id = requestId(request);
  try {
    const params = await context.params;
    const slug = parsePublicSlug(params.slug);
    const conversationId = requireResourceId(request.nextUrl.searchParams.get("conversationId") ?? "", "conversation");
    const runId = requireResourceId(params.runId, "analysis_run");
    const { publication, conversation } = await requirePublicConversation(slug, requestVisitorToken(request), conversationId);
    const response = await analysisRunSseResponse({
      request,
      pool: getPool(),
      runId,
      loadSnapshot: async (client) => (await client.query<AnalysisRunSnapshot>(
        `SELECT run.id,run.version,run.state,run.phase,run.outcome,run.safe_error_code AS "safeErrorCode",run.assistant_message_id AS "assistantMessageId"
         FROM analysis_runs run
         JOIN repositories repository ON repository.id=run.repository_id AND repository.owner_id=run.owner_id AND repository.disabled_at IS NULL
         JOIN publications current_publication ON current_publication.id=$4 AND current_publication.owner_id=run.owner_id AND current_publication.status='published'
         JOIN users owner ON owner.id=run.owner_id AND owner.status='active'
         JOIN agent_settings settings ON settings.owner_id=run.owner_id AND settings.public_mode=true
         WHERE run.id=$1 AND run.owner_id=$2 AND run.conversation_id=$3 AND run.purpose='conversation_analysis'
           AND repository.visibility IN ('citation_allowed','public_preview')`,
        [runId, conversation.ownerId, conversation.id, publication.publicationId],
      )).rows[0] ?? null,
    });
    return withRequestId(response, id);
  } catch (error) {
    return apiFailure(error, id);
  }
}
