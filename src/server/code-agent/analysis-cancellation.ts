import type { PoolClient } from "pg";

async function recordRequested(client: PoolClient, query: string, values: unknown[]) {
  await client.query(
    `WITH requested AS (${query})
     INSERT INTO analysis_run_events(run_id,version,state,phase,safe_error_code)
     SELECT id,version,state,phase,'CODE_AGENT_CANCEL_REQUESTED' FROM requested`,
    values,
  );
}

export function requestAnalysisRunCancellation(client: PoolClient, runId: string, reason: string) {
  return recordRequested(client,
    `UPDATE analysis_runs SET cancel_requested_at=COALESCE(cancel_requested_at,now()),cancel_reason=$2,version=version+1,updated_at=now()
     WHERE id=$1 AND state IN ('pending','running') AND cancel_requested_at IS NULL RETURNING id,version,state,phase`,
    [runId, reason],
  );
}

export function requestOwnerAnalysisCancellation(client: PoolClient, ownerId: string, reason: string) {
  return recordRequested(client,
    `UPDATE analysis_runs SET cancel_requested_at=COALESCE(cancel_requested_at,now()),cancel_reason=$2,version=version+1,updated_at=now()
     WHERE owner_id=$1 AND state IN ('pending','running') AND cancel_requested_at IS NULL RETURNING id,version,state,phase`,
    [ownerId, reason],
  );
}

export function requestOwnerPublicAnalysisCancellation(client: PoolClient, ownerId: string, reason: string) {
  return recordRequested(client,
    `UPDATE analysis_runs run SET cancel_requested_at=COALESCE(run.cancel_requested_at,now()),cancel_reason=$2,version=run.version+1,updated_at=now()
     FROM conversations conversation
     WHERE run.owner_id=$1 AND run.purpose='conversation_analysis'
       AND run.conversation_id=conversation.id AND conversation.mode='public'
       AND run.state IN ('pending','running') AND run.cancel_requested_at IS NULL RETURNING run.id,run.version,run.state,run.phase`,
    [ownerId, reason],
  );
}

export function requestRepositoryAnalysisCancellationInTransaction(client: PoolClient, ownerId: string, repositoryId: string, reason: string) {
  return recordRequested(client,
    `UPDATE analysis_runs SET cancel_requested_at=COALESCE(cancel_requested_at,now()),cancel_reason=$3,version=version+1,updated_at=now()
     WHERE owner_id=$1 AND repository_id=$2 AND state IN ('pending','running') AND cancel_requested_at IS NULL RETURNING id,version,state,phase`,
    [ownerId, repositoryId, reason],
  );
}

export function requestPublicRepositoryAnalysisCancellation(client: PoolClient, ownerId: string, repositoryId: string, reason: string) {
  return recordRequested(client,
    `UPDATE analysis_runs run SET cancel_requested_at=COALESCE(run.cancel_requested_at,now()),cancel_reason=$3,version=run.version+1,updated_at=now()
     FROM conversations conversation
     WHERE run.owner_id=$1 AND run.repository_id=$2 AND run.purpose='conversation_analysis'
       AND run.conversation_id=conversation.id AND conversation.mode='public'
       AND run.state IN ('pending','running') AND run.cancel_requested_at IS NULL RETURNING run.id,run.version,run.state,run.phase`,
    [ownerId, repositoryId, reason],
  );
}

export function requestPublicationAnalysisCancellation(client: PoolClient, publicationId: string, reason: string) {
  return recordRequested(client,
    `UPDATE analysis_runs run SET cancel_requested_at=COALESCE(run.cancel_requested_at,now()),cancel_reason=$2,version=run.version+1,updated_at=now()
     FROM conversations conversation
     WHERE conversation.publication_id=$1 AND run.conversation_id=conversation.id AND run.purpose='conversation_analysis'
       AND run.state IN ('pending','running') AND run.cancel_requested_at IS NULL RETURNING run.id,run.version,run.state,run.phase`,
    [publicationId, reason],
  );
}
