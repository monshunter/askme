"use client";

import { Bot, ExternalLink, FileSearch, MessageSquareText, Quote, ShieldAlert, TrendingDown, TrendingUp, UserRoundPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { adminRequest } from "./admin-api";
import { AdminTrendChart, type AdminTrendPoint, type TrendKey, trendLabels } from "./trend-chart";

type Overview = {
  range: "7d" | "30d" | "90d";
  metrics: Array<{ key: string; label: string; value: number; change: number | null }>;
  recentAgents: Array<{ id: string; slug: string; status: string; publishedAt: string | null; displayName: string; headline: string | null; accountStatus: string; publicSources: number }>;
  reviewQueue: Array<{ id: string; category: string; severity: string; status: string; safeSummary: string; createdAt: string; slug: string | null; displayName: string | null }>;
  trend: AdminTrendPoint[];
  hasTrendData: boolean;
};

const metricIcons = [UsersRound, Bot, MessageSquareText, Quote, ShieldAlert];

function dateLabel(value: string | null) { return value ? new Date(value).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" }) : "Not published"; }

export function AdminOverviewClient({ initialOverview, adminName }: { initialOverview: Overview; adminName: string }) {
  const [overview, setOverview] = useState(initialOverview);
  const [series, setSeries] = useState<TrendKey>("candidates");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function changeRange(range: Overview["range"]) {
    setLoading(true); setFeedback(null);
    try { setOverview(await adminRequest<Overview>(`/api/admin/overview?range=${range}`, { cache: "no-store" })); }
    catch (error) { setFeedback(error instanceof Error ? error.message : "The Overview could not be refreshed."); }
    finally { setLoading(false); }
  }

  return <div className="admin-page admin-overview-page">
    <section className="admin-hero"><p className="page-kicker">Governance Workspace</p><h1>Platform Admin <span className="title-seal" aria-hidden="true">问候</span></h1><p>Welcome back, {adminName}. Here&apos;s what&apos;s happening on your platform.</p></section>
    {feedback ? <div className="inline-feedback error" role="alert">{feedback}</div> : null}
    <section className="admin-metric-grid" aria-label="Platform metrics">{overview.metrics.map((metric, index) => { const Icon = metricIcons[index]!; return <article className="admin-metric-card" key={metric.key}><span><Icon size={29} /></span><div><small>{metric.label}</small><strong>{metric.value.toLocaleString("en-US")}</strong><em className={metric.change === null ? "neutral" : metric.change >= 0 ? "positive" : "negative"}>{metric.change === null ? "No prior baseline" : <>{metric.change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{Math.abs(metric.change)}% vs prior period</>}</em></div></article>; })}</section>
    <div className="admin-overview-grid">
      <section className="admin-card admin-recent-agents"><header><h2>Recently Published Agents</h2><Link href="/admin/agents">View all</Link></header>{overview.recentAgents.length === 0 ? <div className="admin-empty"><Bot size={27} /><p>No published Agents yet.</p></div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>Agent</th><th>Headline</th><th>Published</th><th>Status</th><th>Sources</th><th><span className="sr-only">Open</span></th></tr></thead><tbody>{overview.recentAgents.map((agent) => <tr key={agent.id}><td data-label="Agent"><strong>{agent.displayName}</strong><small>{agent.slug.slice(0, 12)}…</small></td><td data-label="Headline">{agent.headline ?? "No headline"}</td><td data-label="Published">{dateLabel(agent.publishedAt)}</td><td data-label="Status"><span className={`admin-status ${agent.status}`}>{agent.status}</span></td><td data-label="Sources">{agent.publicSources}</td><td><Link href={`/a/${agent.slug}`} target="_blank" aria-label={`Open ${agent.displayName} public Agent`}><ExternalLink size={16} /></Link></td></tr>)}</tbody></table></div>}</section>
      <section className="admin-card admin-review-preview"><header><h2>Content / Citation Review</h2><Link href="/admin/reviews">View all</Link></header>{overview.reviewQueue.length === 0 ? <div className="admin-empty"><FileSearch size={27} /><p>The review queue is clear.</p></div> : <ul>{overview.reviewQueue.map((flag) => <li key={flag.id}><span className={`admin-risk-icon ${flag.severity}`}><ShieldAlert size={18} /></span><div><strong>{flag.category.replaceAll("_", " ")}</strong><small>{flag.displayName ?? "Unavailable Agent"} · {dateLabel(flag.createdAt)}</small><p>{flag.safeSummary}</p></div><em className={`admin-status ${flag.severity}`}>{flag.severity}</em></li>)}</ul>}</section>
      <section className="admin-card admin-growth-card"><header><h2>Platform Growth</h2><label><span className="sr-only">Trend range</span><select value={overview.range} disabled={loading} onChange={(event) => void changeRange(event.target.value as Overview["range"])}><option value="7d">Last 7 days</option><option value="30d">Last 30 days</option><option value="90d">Last 90 days</option></select></label></header><div className="admin-series-tabs">{(Object.keys(trendLabels) as TrendKey[]).map((key) => <button type="button" key={key} className={series === key ? "active" : ""} onClick={() => setSeries(key)}>{trendLabels[key]}</button>)}</div>{overview.hasTrendData ? <AdminTrendChart points={overview.trend} series={series} /> : <div className="admin-empty chart-empty"><TrendingUp size={28} /><p>No activity in this range. No sample curve is shown.</p></div>}</section>
      <section className="admin-card admin-quick-card"><header><h2>Quick Actions</h2></header><Link href="/admin/reviews"><FileSearch size={19} /><span><strong>Review Content Queue</strong><small>{overview.reviewQueue.length} item{overview.reviewQueue.length === 1 ? "" : "s"} in this preview</small></span></Link><Link href="/admin/agents"><Bot size={19} /><span><strong>Manage Published Agents</strong><small>Pause, restore, and open public views</small></span></Link><Link href="/admin/settings#invite"><UserRoundPlus size={19} /><span><strong>Invite Admin</strong><small>Available only with configured SMTP</small></span></Link><Link href="/admin/settings"><ShieldAlert size={19} /><span><strong>Platform Settings</strong><small>Health, limits, and non-secret policies</small></span></Link></section>
    </div>
    <footer className="admin-footer"><span>© 2026 Askme. All rights reserved.</span><span>Private originals are excluded from Admin projections.</span><span>English</span></footer>
  </div>;
}
