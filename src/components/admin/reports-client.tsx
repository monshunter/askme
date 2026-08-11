"use client";

import { Bot, MessageSquareText, Quote, ShieldAlert, TrendingUp, UsersRound } from "lucide-react";
import { useMemo, useState } from "react";

import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

import { adminRequest } from "./admin-api";
import { AdminTrendChart, type AdminTrendPoint, type TrendKey, trendLabel } from "./trend-chart";

type Report = { range: "7d" | "30d" | "90d"; totals: { totalCandidates: number; publishedAgents: number; activeInterviews: number; citationUsage: number; flaggedContent: number }; trend: AdminTrendPoint[]; hasData: boolean; distributions: { aiOutcomes: Array<{ outcome: string; count: number }>; candidateStatus: Array<{ status: string; count: number }>; publicationStatus: Array<{ status: string; count: number }>; reviewStatus: Array<{ status: string; count: number }> } };

const metricDefinitions = [
  { key: "totalCandidates", label: "admin.metric.candidates", icon: UsersRound },
  { key: "publishedAgents", label: "admin.metric.publishedAgents", icon: Bot },
  { key: "activeInterviews", label: "admin.metric.activeInterviews", icon: MessageSquareText },
  { key: "citationUsage", label: "admin.metric.citations", icon: Quote },
  { key: "flaggedContent", label: "admin.metric.openReviews", icon: ShieldAlert },
] as const;
const trendKeys: TrendKey[] = ["candidates", "publishedAgents", "activeInterviews", "citationUsage", "flaggedContent"];

function valueLabel(value: string, locale: Locale) {
  const t = createTranslator(locale);
  const statusKey = `status.${value}` as TranslationKey;
  const known = ["active", "suspended", "draft", "published", "paused", "revoked", "open", "reviewing", "resolved", "dismissed", "failed", "completed"];
  return known.includes(value) ? t(statusKey) : value.replaceAll("_", " ");
}

export function ReportsClient({ initialReport, locale }: { initialReport: Report; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [report, setReport] = useState(initialReport);
  const [series, setSeries] = useState<TrendKey>("candidates");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeRange(range: Report["range"]) {
    setLoading(true);
    setError(null);
    try {
      const next = await adminRequest<Report>(`/api/admin/reports?range=${range}`, { cache: "no-store" });
      setReport(next);
      window.history.replaceState(null, "", `/admin/reports?range=${range}`);
    } catch {
      setError(t("admin.reports.refreshFailed"));
    } finally {
      setLoading(false);
    }
  }

  return <div className="admin-page">
    <section className="admin-hero compact"><p className="page-kicker">{t("admin.reports.kicker")}</p><h1>{t("admin.reports.title")} <span className="title-seal" aria-hidden="true">问候</span></h1><p>{t("admin.reports.copy")}</p></section>
    {error ? <div className="inline-feedback error" role="alert">{error}</div> : null}
    <section className="admin-report-controls"><label>{t("admin.range.time")}<select value={report.range} disabled={loading} onChange={(event) => void changeRange(event.target.value as Report["range"])}><option value="7d">{t("admin.range.7d")}</option><option value="30d">{t("admin.range.30d")}</option><option value="90d">{t("admin.range.90d")}</option></select></label></section>
    <section className="admin-metric-grid report-metrics">{metricDefinitions.map(({ key, label, icon: Icon }) => <article className="admin-metric-card" key={key}><span><Icon size={27} /></span><div><small>{t(label)}</small><strong>{report.totals[key].toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US")}</strong><em className="neutral">{t("admin.reports.fact")}</em></div></article>)}</section>
    <section className="admin-card admin-report-chart"><header><div><h2>{t("admin.reports.activity")}</h2><small>{t("admin.reports.buckets")}</small></div></header><div className="admin-series-tabs">{trendKeys.map((key) => <button key={key} type="button" className={series === key ? "active" : ""} onClick={() => setSeries(key)}>{trendLabel(locale, key)}</button>)}</div>{report.hasData ? <AdminTrendChart points={report.trend} series={series} locale={locale} /> : <div className="admin-empty large"><TrendingUp size={31} /><h2>{t("admin.reports.empty")}</h2><p>{t("admin.reports.emptyCopy")}</p></div>}</section>
    <section className="admin-distribution-grid"><Distribution title={t("admin.reports.candidateStatus")} rows={report.distributions.candidateStatus} locale={locale} /><Distribution title={t("admin.reports.publicationStatus")} rows={report.distributions.publicationStatus} locale={locale} /><Distribution title={t("admin.reports.reviewStatus")} rows={report.distributions.reviewStatus} locale={locale} /><Distribution title={t("admin.reports.aiOutcomes")} rows={report.distributions.aiOutcomes} locale={locale} /></section>
  </div>;
}

function Distribution({ title, rows, locale }: { title: string; rows: Array<{ status?: string; outcome?: string; count: number }>; locale: Locale }) {
  const t = createTranslator(locale);
  const total = rows.reduce((sum, row) => sum + row.count, 0);
  return <section className="admin-card admin-distribution"><header><h2>{title}</h2><strong>{total}</strong></header>{rows.length === 0 ? <p>{t("admin.reports.noData")}</p> : <ul>{rows.map((row) => { const value = row.status ?? row.outcome ?? ""; return <li key={value}><span>{valueLabel(value, locale)}</span><strong>{row.count}</strong><i style={{ width: `${total === 0 ? 0 : (row.count / total) * 100}%` }} /></li>; })}</ul>}</section>;
}
