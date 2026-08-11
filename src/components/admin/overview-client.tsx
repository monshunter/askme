"use client";

import { Bot, ExternalLink, FileSearch, MessageSquareText, Quote, ShieldAlert, TrendingDown, TrendingUp, UserRoundPlus, UsersRound } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

import { adminRequest } from "./admin-api";
import { AdminTrendChart, type AdminTrendPoint, type TrendKey, trendLabel } from "./trend-chart";

type Overview = {
  range: "7d" | "30d" | "90d";
  metrics: Array<{ key: string; label: string; value: number; change: number | null }>;
  recentAgents: Array<{ id: string; slug: string; status: string; publishedAt: string | null; displayName: string; headline: string | null; accountStatus: string; publicSources: number }>;
  reviewQueue: Array<{ id: string; category: string; severity: string; status: string; safeSummary: string; createdAt: string; slug: string | null; displayName: string | null }>;
  trend: AdminTrendPoint[];
  hasTrendData: boolean;
};

const metricIcons = [UsersRound, Bot, MessageSquareText, Quote, ShieldAlert];
const trendKeys: TrendKey[] = ["candidates", "publishedAgents", "activeInterviews", "citationUsage", "flaggedContent"];

function metricLabel(key: string, locale: Locale) {
  const t = createTranslator(locale);
  if (key === "totalCandidates") return t("admin.metric.totalCandidates");
  if (key === "publishedAgents") return t("admin.metric.publishedAgents");
  if (key === "activeInterviews") return t("admin.metric.activeInterviews");
  if (key === "citationUsage") return t("admin.metric.citationUsage");
  return t("admin.metric.flaggedContent");
}

function dateLabel(value: string | null, locale: Locale) {
  if (!value) return createTranslator(locale)("admin.notPublished");
  return new Date(value).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
}

export function AdminOverviewClient({ initialOverview, adminName, locale }: { initialOverview: Overview; adminName: string; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [overview, setOverview] = useState(initialOverview);
  const [series, setSeries] = useState<TrendKey>("candidates");
  const [loading, setLoading] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function changeRange(range: Overview["range"]) {
    setLoading(true);
    setFeedback(null);
    try {
      setOverview(await adminRequest<Overview>(`/api/admin/overview?range=${range}`, { cache: "no-store" }));
    } catch {
      setFeedback(t("admin.overview.refreshFailed"));
    } finally {
      setLoading(false);
    }
  }

  return <div className="admin-page admin-overview-page">
    <section className="admin-hero"><p className="page-kicker">{t("admin.overview.kicker")}</p><h1>{t("admin.overview.title")} <span className="title-seal" aria-hidden="true">问候</span></h1><p>{t("admin.overview.copy", { name: adminName })}</p></section>
    {feedback ? <div className="inline-feedback error" role="alert">{feedback}</div> : null}
    <section className="admin-metric-grid" aria-label={t("admin.metrics.label")}>{overview.metrics.map((metric, index) => { const Icon = metricIcons[index] ?? ShieldAlert; return <article className="admin-metric-card" key={metric.key}><span><Icon size={29} /></span><div><small>{metricLabel(metric.key, locale)}</small><strong>{metric.value.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")}</strong><em className={metric.change === null ? "neutral" : metric.change >= 0 ? "positive" : "negative"}>{metric.change === null ? t("admin.metric.noBaseline") : <>{metric.change >= 0 ? <TrendingUp size={13} /> : <TrendingDown size={13} />}{t("admin.metric.change", { change: Math.abs(metric.change) })}</>}</em></div></article>; })}</section>
    <div className="admin-overview-grid">
      <section className="admin-card admin-recent-agents"><header><h2>{t("admin.recent.title")}</h2><Link href="/admin/agents">{t("admin.viewAll")}</Link></header>{overview.recentAgents.length === 0 ? <div className="admin-empty"><Bot size={27} /><p>{t("admin.recent.empty")}</p></div> : <div className="admin-table-wrap"><table className="admin-table"><thead><tr><th>{t("admin.column.agent")}</th><th>{t("admin.column.headline")}</th><th>{t("admin.column.published")}</th><th>{t("admin.column.status")}</th><th>{t("admin.column.sources")}</th><th><span className="sr-only">{t("admin.open")}</span></th></tr></thead><tbody>{overview.recentAgents.map((agent) => <tr key={agent.id}><td data-label={t("admin.column.agent")}><strong>{agent.displayName}</strong><small>{agent.slug.slice(0, 12)}…</small></td><td data-label={t("admin.column.headline")}>{agent.headline ?? t("admin.noHeadline")}</td><td data-label={t("admin.column.published")}>{dateLabel(agent.publishedAt, locale)}</td><td data-label={t("admin.column.status")}><span className={`admin-status ${agent.status}`}>{t(`status.${agent.status}` as TranslationKey)}</span></td><td data-label={t("admin.column.sources")}>{agent.publicSources}</td><td><Link href={`/a/${agent.slug}`} target="_blank" aria-label={t("admin.openAgent", { name: agent.displayName })}><ExternalLink size={16} /></Link></td></tr>)}</tbody></table></div>}</section>
      <section className="admin-card admin-review-preview"><header><h2>{t("admin.reviewPreview.title")}</h2><Link href="/admin/reviews">{t("admin.viewAll")}</Link></header>{overview.reviewQueue.length === 0 ? <div className="admin-empty"><FileSearch size={27} /><p>{t("admin.reviewPreview.clear")}</p></div> : <ul>{overview.reviewQueue.map((flag) => <li key={flag.id}><span className={`admin-risk-icon ${flag.severity}`}><ShieldAlert size={18} /></span><div><strong>{flag.category.replaceAll("_", " ")}</strong><small>{flag.displayName ?? t("admin.unavailableAgent")} · {dateLabel(flag.createdAt, locale)}</small><p>{flag.safeSummary}</p></div><em className={`admin-status ${flag.severity}`}>{t(`status.${flag.severity}` as TranslationKey)}</em></li>)}</ul>}</section>
      <section className="admin-card admin-growth-card"><header><h2>{t("admin.growth.title")}</h2><label><span className="sr-only">{t("admin.range.label")}</span><select value={overview.range} disabled={loading} onChange={(event) => void changeRange(event.target.value as Overview["range"])}><option value="7d">{t("admin.range.7d")}</option><option value="30d">{t("admin.range.30d")}</option><option value="90d">{t("admin.range.90d")}</option></select></label></header><div className="admin-series-tabs">{trendKeys.map((key) => <button type="button" key={key} className={series === key ? "active" : ""} onClick={() => setSeries(key)}>{trendLabel(locale, key)}</button>)}</div>{overview.hasTrendData ? <AdminTrendChart points={overview.trend} series={series} locale={locale} /> : <div className="admin-empty chart-empty"><TrendingUp size={28} /><p>{t("admin.growth.empty")}</p></div>}</section>
      <section className="admin-card admin-quick-card"><header><h2>{t("admin.quick.title")}</h2></header><Link href="/admin/reviews"><FileSearch size={19} /><span><strong>{t("admin.quick.reviewTitle")}</strong><small>{t("admin.quick.reviewCopy", { count: overview.reviewQueue.length })}</small></span></Link><Link href="/admin/agents"><Bot size={19} /><span><strong>{t("admin.quick.agentsTitle")}</strong><small>{t("admin.quick.agentsCopy")}</small></span></Link><Link href="/admin/settings#invite"><UserRoundPlus size={19} /><span><strong>{t("admin.quick.inviteTitle")}</strong><small>{t("admin.quick.inviteCopy")}</small></span></Link><Link href="/admin/settings"><ShieldAlert size={19} /><span><strong>{t("admin.quick.settingsTitle")}</strong><small>{t("admin.quick.settingsCopy")}</small></span></Link></section>
    </div>
    <footer className="admin-footer"><span>{t("shared.footerRights")}</span><span>{t("admin.footer.boundary")}</span><LanguageSwitcher locale={locale} compact /></footer>
  </div>;
}
