import "server-only";

import { getPool } from "@/server/db/client";

import { adminRangeWindow, buildUtcDateBuckets, comparableChange } from "./admin-analytics";
import type { AdminRange } from "./admin-input";

type MetricFacts = {
  totalCandidates: number;
  candidatesCurrent: number;
  candidatesPrevious: number;
  publishedAgents: number;
  publicationsCurrent: number;
  publicationsPrevious: number;
  activeInterviews: number;
  interviewsCurrent: number;
  interviewsPrevious: number;
  citationUsage: number;
  citationsPrevious: number;
  flaggedContent: number;
  flagsCurrent: number;
  flagsPrevious: number;
};

type TrendRow = {
  date: string;
  candidates: number;
  publishedAgents: number;
  activeInterviews: number;
  citationUsage: number;
  flaggedContent: number;
};

const metricLabels = {
  totalCandidates: "Total Candidates",
  publishedAgents: "Published Agents",
  activeInterviews: "Active Interviews",
  citationUsage: "Citation Usage",
  flaggedContent: "Flagged Content",
} as const;

async function loadMetricFacts(range: AdminRange) {
  const { start, end, previousStart } = adminRangeWindow(range);
  const result = await getPool().query<MetricFacts>(
    `SELECT
       (SELECT count(*)::int FROM users WHERE role='candidate') AS "totalCandidates",
       (SELECT count(*)::int FROM users WHERE role='candidate' AND created_at >= $1 AND created_at < $2) AS "candidatesCurrent",
       (SELECT count(*)::int FROM users WHERE role='candidate' AND created_at >= $3 AND created_at < $1) AS "candidatesPrevious",
       (SELECT count(*)::int FROM publications publication
          JOIN users candidate ON candidate.id=publication.owner_id AND candidate.status='active'
          JOIN agent_settings settings ON settings.owner_id=publication.owner_id AND settings.public_mode=true
         WHERE publication.status='published') AS "publishedAgents",
       (SELECT count(*)::int FROM publications WHERE published_at >= $1 AND published_at < $2) AS "publicationsCurrent",
       (SELECT count(*)::int FROM publications WHERE published_at >= $3 AND published_at < $1) AS "publicationsPrevious",
       (SELECT count(*)::int FROM conversations
         WHERE mode='public' AND expires_at>now() AND last_activity_at>now()-interval '24 hours') AS "activeInterviews",
       (SELECT count(*)::int FROM conversations WHERE mode='public' AND created_at >= $1 AND created_at < $2) AS "interviewsCurrent",
       (SELECT count(*)::int FROM conversations WHERE mode='public' AND created_at >= $3 AND created_at < $1) AS "interviewsPrevious",
       (SELECT count(*)::int FROM message_citations citation
          JOIN messages message ON message.id=citation.message_id
          JOIN conversations conversation ON conversation.id=message.conversation_id AND conversation.mode='public'
         WHERE message.created_at >= $1 AND message.created_at < $2) AS "citationUsage",
       (SELECT count(*)::int FROM message_citations citation
          JOIN messages message ON message.id=citation.message_id
          JOIN conversations conversation ON conversation.id=message.conversation_id AND conversation.mode='public'
         WHERE message.created_at >= $3 AND message.created_at < $1) AS "citationsPrevious",
       (SELECT count(*)::int FROM content_flags WHERE status IN ('open','reviewing')) AS "flaggedContent",
       (SELECT count(*)::int FROM content_flags WHERE created_at >= $1 AND created_at < $2) AS "flagsCurrent",
       (SELECT count(*)::int FROM content_flags WHERE created_at >= $3 AND created_at < $1) AS "flagsPrevious"`,
    [start, end, previousStart],
  );
  return result.rows[0]!;
}

async function loadTrend(range: AdminRange): Promise<TrendRow[]> {
  const { days } = adminRangeWindow(range);
  const dates = buildUtcDateBuckets(new Date(), days);
  const result = await getPool().query<TrendRow>(
    `WITH dates AS (
       SELECT generate_series($1::date,$2::date,interval '1 day')::date AS day
     )
     SELECT to_char(dates.day,'YYYY-MM-DD') AS date,
       (SELECT count(*)::int FROM users WHERE role='candidate' AND created_at>=dates.day AND created_at<dates.day+1) AS candidates,
       (SELECT count(*)::int FROM publications WHERE published_at>=dates.day AND published_at<dates.day+1) AS "publishedAgents",
       (SELECT count(*)::int FROM conversations WHERE mode='public' AND created_at>=dates.day AND created_at<dates.day+1) AS "activeInterviews",
       (SELECT count(*)::int FROM message_citations citation
          JOIN messages message ON message.id=citation.message_id
          JOIN conversations conversation ON conversation.id=message.conversation_id AND conversation.mode='public'
         WHERE message.created_at>=dates.day AND message.created_at<dates.day+1) AS "citationUsage",
       (SELECT count(*)::int FROM content_flags WHERE created_at>=dates.day AND created_at<dates.day+1) AS "flaggedContent"
     FROM dates ORDER BY dates.day`,
    [dates[0], dates.at(-1)],
  );
  return result.rows;
}

export async function loadAdminOverview(range: AdminRange) {
  const [facts, recentAgentsResult, reviewQueueResult, trend] = await Promise.all([
    loadMetricFacts(range),
    getPool().query(
      `SELECT publication.id,publication.slug,publication.status,
              publication.published_at AS "publishedAt",publication.updated_at AS "updatedAt",
              candidate.display_name AS "displayName",candidate.headline,candidate.status AS "accountStatus",
              (SELECT count(*)::int FROM materials
                WHERE owner_id=publication.owner_id AND status='indexed' AND visibility IN ('citation_allowed','public_preview')) AS "publicSources"
       FROM publications publication
       JOIN users candidate ON candidate.id=publication.owner_id AND candidate.role='candidate'
       WHERE publication.status IN ('published','paused')
       ORDER BY publication.published_at DESC NULLS LAST,publication.updated_at DESC,publication.id DESC LIMIT 5`,
    ),
    getPool().query(
      `SELECT flag.id,flag.category,flag.severity,flag.status,flag.safe_summary AS "safeSummary",
              flag.created_at AS "createdAt",publication.slug,candidate.display_name AS "displayName"
       FROM content_flags flag
       LEFT JOIN publications publication ON publication.id=flag.publication_id
       LEFT JOIN users candidate ON candidate.id=publication.owner_id
       WHERE flag.status IN ('open','reviewing')
       ORDER BY CASE flag.severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END,
                flag.created_at ASC,flag.id ASC LIMIT 5`,
    ),
    loadTrend(range),
  ]);

  return {
    range,
    metrics: [
      { key: "totalCandidates", label: metricLabels.totalCandidates, value: facts.totalCandidates, change: comparableChange(facts.candidatesCurrent, facts.candidatesPrevious) },
      { key: "publishedAgents", label: metricLabels.publishedAgents, value: facts.publishedAgents, change: comparableChange(facts.publicationsCurrent, facts.publicationsPrevious) },
      { key: "activeInterviews", label: metricLabels.activeInterviews, value: facts.activeInterviews, change: comparableChange(facts.interviewsCurrent, facts.interviewsPrevious) },
      { key: "citationUsage", label: metricLabels.citationUsage, value: facts.citationUsage, change: comparableChange(facts.citationUsage, facts.citationsPrevious) },
      { key: "flaggedContent", label: metricLabels.flaggedContent, value: facts.flaggedContent, change: comparableChange(facts.flagsCurrent, facts.flagsPrevious) },
    ],
    recentAgents: recentAgentsResult.rows,
    reviewQueue: reviewQueueResult.rows,
    trend,
    hasTrendData: trend.some((point) => point.candidates + point.publishedAgents + point.activeInterviews + point.citationUsage + point.flaggedContent > 0),
  };
}

export async function loadAdminReport(range: AdminRange) {
  const [facts, trend, aiOutcomesResult, accountStatesResult, publicationStatesResult, reviewStatesResult] = await Promise.all([
    loadMetricFacts(range),
    loadTrend(range),
    (() => {
      const { start, end } = adminRangeWindow(range);
      return getPool().query<{ outcome: string; count: number }>(
        `SELECT outcome,count(*)::int AS count FROM ai_usage WHERE created_at >= $1 AND created_at < $2 GROUP BY outcome ORDER BY outcome`,
        [start, end],
      );
    })(),
    getPool().query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM users WHERE role='candidate' GROUP BY status ORDER BY status"),
    getPool().query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM publications GROUP BY status ORDER BY status"),
    getPool().query<{ status: string; count: number }>("SELECT status,count(*)::int AS count FROM content_flags GROUP BY status ORDER BY status"),
  ]);
  return {
    range,
    totals: {
      totalCandidates: facts.totalCandidates,
      publishedAgents: facts.publishedAgents,
      activeInterviews: facts.activeInterviews,
      citationUsage: facts.citationUsage,
      flaggedContent: facts.flaggedContent,
    },
    trend,
    hasData: trend.some((point) => point.candidates + point.publishedAgents + point.activeInterviews + point.citationUsage + point.flaggedContent > 0),
    distributions: {
      aiOutcomes: aiOutcomesResult.rows,
      candidateStatus: accountStatesResult.rows,
      publicationStatus: publicationStatesResult.rows,
      reviewStatus: reviewStatesResult.rows,
    },
  };
}
