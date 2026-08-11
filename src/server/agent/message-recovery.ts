import type { Pool } from "pg";

export async function recoverStaleAnswers(conversationId: string, ownerId: string, pool: Pick<Pool, "query">) {
  const result = await pool.query(
    `UPDATE messages SET status='failed',content='The answer was interrupted before it completed. Retry the question.',error_code='REQUEST_INTERRUPTED'
     WHERE conversation_id=$1 AND owner_id=$2 AND role='assistant' AND status='pending'
       AND created_at<now()-interval '2 minutes'`,
    [conversationId, ownerId],
  );
  return result.rowCount ?? 0;
}
