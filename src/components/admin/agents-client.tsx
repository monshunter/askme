"use client";

import { Bot, ExternalLink, PauseCircle, PlayCircle, Search } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useMemo, useState } from "react";

import { createTranslator, type Locale } from "@/i18n/core";

import { adminRequest } from "./admin-api";
import { GovernanceDialog } from "./governance-dialog";

type Agent = { id: string; slug: string; status: "published" | "paused" | "revoked"; publishedAt: string | null; pausedAt: string | null; pauseReason: string | null; updatedAt: string; candidateId: string; displayName: string; headline: string | null; accountStatus: "active" | "suspended"; publicSources: number; publicKnowledgeItems: number };
type AgentPage = { items: Agent[]; page: number; pageSize: number; total: number; totalPages: number };
type AgentFilters = { search: string; status: "all" | "published" | "paused" | "revoked"; page: number; pageSize: number };

export function AgentsClient({ initialPage, initialFilters, locale }: { initialPage: AgentPage; initialFilters: AgentFilters; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [data, setData] = useState(initialPage);
  const [filters, setFilters] = useState(initialFilters);
  const [draftSearch, setDraftSearch] = useState(initialFilters.search);
  const [active, setActive] = useState<Agent | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refresh(next: AgentFilters) {
    const params = new URLSearchParams({ search: next.search, status: next.status, page: String(next.page), pageSize: String(next.pageSize) });
    setData(await adminRequest<AgentPage>(`/api/admin/agents?${params}`, { cache: "no-store" }));
    setFilters(next);
    window.history.replaceState(null, "", `/admin/agents?${params}`);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void refresh({ ...filters, search: draftSearch.trim(), page: 1 }).catch(() => setFeedback(t("admin.agents.searchFailed")));
  }

  async function govern(reason: string) {
    if (!active) return;
    setPending(true);
    setDialogError(null);
    const action = active.status === "paused" ? "restore" : "pause";
    try {
      await adminRequest(`/api/admin/agents/${active.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, reason }) });
      await refresh(filters);
      setActive(null);
      setFeedback(t("admin.agents.changed", { name: active.displayName, action: t(action === "pause" ? "admin.agents.paused" : "admin.agents.restored") }));
    } catch {
      setDialogError(t("admin.agents.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return <div className="admin-page">
    <section className="admin-hero compact"><p className="page-kicker">{t("admin.agents.kicker")}</p><h1>{t("admin.agents.title")} <span className="title-seal" aria-hidden="true">职问</span></h1><p>{t("admin.agents.copy")}</p></section>
    {feedback ? <div className="inline-feedback info" role="status">{feedback}<button type="button" onClick={() => setFeedback(null)} aria-label={t("shared.dismiss")}>×</button></div> : null}
    <section className="admin-card admin-directory-card"><header className="admin-directory-header"><div><h2>{t("admin.agents.directory")}</h2><small>{t("admin.agents.count", { count: data.total })}</small></div><form onSubmit={search} role="search"><Search size={17} /><input aria-label={t("admin.agents.searchLabel")} value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder={t("admin.agents.searchPlaceholder")} /><button>{t("shared.search")}</button></form><label>{t("admin.column.status")}<select value={filters.status} onChange={(event) => void refresh({ ...filters, status: event.target.value as AgentFilters["status"], page: 1 }).catch(() => setFeedback(t("admin.candidates.filterFailed")))}><option value="all">{t("admin.reviews.all")}</option><option value="published">{t("status.published")}</option><option value="paused">{t("status.paused")}</option><option value="revoked">{t("status.revoked")}</option></select></label></header>
      {data.items.length === 0 ? <div className="admin-empty large"><Bot size={31} /><h2>{t("admin.agents.empty")}</h2><p>{t("admin.agents.emptyCopy")}</p></div> : <div className="admin-table-wrap"><table className="admin-table directory"><thead><tr><th>{t("admin.column.agent")}</th><th>{t("admin.column.status")}</th><th>{t("admin.column.account")}</th><th>{t("admin.agents.publicSources")}</th><th>{t("admin.column.knowledge")}</th><th>{t("admin.column.updated")}</th><th>{t("admin.column.actions")}</th></tr></thead><tbody>{data.items.map((agent) => <tr key={agent.id}><td data-label={t("admin.column.agent")}><strong>{agent.displayName}</strong><small>{agent.headline ?? agent.slug}</small></td><td data-label={t("admin.column.status")}><span className={`admin-status ${agent.status}`}>{t(`status.${agent.status}`)}</span></td><td data-label={t("admin.column.account")}><span className={`admin-status ${agent.accountStatus}`}>{t(`status.${agent.accountStatus}`)}</span></td><td data-label={t("admin.agents.publicSources")}>{agent.publicSources}</td><td data-label={t("admin.column.knowledge")}>{agent.publicKnowledgeItems}</td><td data-label={t("admin.column.updated")}>{new Date(agent.updatedAt).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" })}</td><td data-label={t("admin.column.actions")}><span className="admin-row-actions">{agent.status === "published" || agent.status === "paused" ? <button type="button" className={agent.status === "published" ? "admin-row-action danger" : "admin-row-action"} disabled={agent.status === "paused" && agent.accountStatus === "suspended"} title={agent.status === "paused" && agent.accountStatus === "suspended" ? t("admin.agents.restoreCandidate") : undefined} onClick={() => { setActive(agent); setDialogError(null); }}>{agent.status === "published" ? <><PauseCircle size={15} /> {t("admin.agents.pause")}</> : <><PlayCircle size={15} /> {t("admin.agents.restore")}</>}</button> : null}{agent.status === "published" && agent.accountStatus === "active" ? <Link href={`/a/${agent.slug}`} target="_blank" className="admin-row-action"><ExternalLink size={15} /> {t("admin.open")}</Link> : null}</span></td></tr>)}</tbody></table></div>}
      <footer className="admin-pagination"><span>{t("admin.page", { page: data.page, total: data.totalPages })}</span><button disabled={data.page <= 1} onClick={() => void refresh({ ...filters, page: data.page - 1 })}>{t("shared.previous")}</button><button disabled={data.page >= data.totalPages} onClick={() => void refresh({ ...filters, page: data.page + 1 })}>{t("shared.next")}</button></footer>
    </section>
    {active ? <GovernanceDialog title={t(active.status === "published" ? "admin.agents.pauseTitle" : "admin.agents.restoreTitle", { name: active.displayName })} copy={t(active.status === "published" ? "admin.agents.pauseCopy" : "admin.agents.restoreCopy")} submitLabel={t(active.status === "published" ? "admin.agents.pauseSubmit" : "admin.agents.restoreSubmit")} pending={pending} error={dialogError} locale={locale} onClose={() => { if (!pending) setActive(null); }} onSubmit={govern} /> : null}
  </div>;
}
