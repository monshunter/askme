"use client";

import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Search, UserRoundCheck, UsersRound } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { createTranslator, type Locale } from "@/i18n/core";

import { adminRequest } from "./admin-api";
import { GovernanceDialog } from "./governance-dialog";

type Candidate = { id: string; displayName: string; email: string; status: "active" | "suspended"; createdAt: string; updatedAt: string; materialCount: number; knowledgeCount: number; publicationStatus: "draft" | "published" | "paused" | "revoked" | null };
type CandidatePage = { items: Candidate[]; page: number; pageSize: number; total: number; totalPages: number };
type CandidateFilters = { search: string; status: "all" | "active" | "suspended"; page: number; pageSize: number };

function dateLabel(value: string, locale: Locale) {
  return new Date(value).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", { dateStyle: "medium", timeZone: "UTC" });
}

export function CandidatesClient({ initialPage, initialFilters, locale }: { initialPage: CandidatePage; initialFilters: CandidateFilters; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [data, setData] = useState(initialPage);
  const [filters, setFilters] = useState(initialFilters);
  const [draftSearch, setDraftSearch] = useState(initialFilters.search);
  const [active, setActive] = useState<Candidate | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refresh(next: CandidateFilters) {
    const params = new URLSearchParams({ search: next.search, status: next.status, page: String(next.page), pageSize: String(next.pageSize) });
    setData(await adminRequest<CandidatePage>(`/api/admin/candidates?${params}`, { cache: "no-store" }));
    setFilters(next);
    window.history.replaceState(null, "", `/admin/candidates?${params}`);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void refresh({ ...filters, search: draftSearch.trim(), page: 1 }).catch(() => setFeedback(t("admin.candidates.searchFailed")));
  }

  async function changeStatus(reason: string) {
    if (!active) return;
    setPending(true);
    setDialogError(null);
    const nextStatus = active.status === "active" ? "suspended" : "active";
    try {
      await adminRequest(`/api/admin/candidates/${active.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus, reason }) });
      await refresh(filters);
      setActive(null);
      setFeedback(t("admin.candidates.changed", { name: active.displayName, status: t(`status.${nextStatus}`) }));
    } catch {
      setDialogError(t("admin.candidates.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  return <div className="admin-page">
    <section className="admin-hero compact"><p className="page-kicker">{t("admin.candidates.kicker")}</p><h1>{t("admin.candidates.title")} <span className="title-seal" aria-hidden="true">职问</span></h1><p>{t("admin.candidates.copy")}</p></section>
    {feedback ? <div className="inline-feedback info" role="status">{feedback}<button type="button" onClick={() => setFeedback(null)} aria-label={t("shared.dismiss")}>×</button></div> : null}
    <section className="admin-card admin-directory-card"><header className="admin-directory-header"><div><h2>{t("admin.candidates.accounts")}</h2><small>{t("admin.candidates.count", { count: data.total.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US") })}</small></div><form onSubmit={search} role="search"><Search size={17} /><label className="sr-only" htmlFor="candidate-search">{t("admin.candidates.searchLabel")}</label><input id="candidate-search" value={draftSearch} maxLength={120} onChange={(event) => setDraftSearch(event.target.value)} placeholder={t("admin.candidates.searchPlaceholder")} /><button type="submit">{t("shared.search")}</button></form><label>{t("admin.column.status")}<select value={filters.status} onChange={(event) => void refresh({ ...filters, status: event.target.value as CandidateFilters["status"], page: 1 }).catch(() => setFeedback(t("admin.candidates.filterFailed")))}><option value="all">{t("admin.reviews.all")}</option><option value="active">{t("status.active")}</option><option value="suspended">{t("status.suspended")}</option></select></label></header>
      {data.items.length === 0 ? <div className="admin-empty large"><UsersRound size={31} /><h2>{t("admin.candidates.empty")}</h2><p>{t("admin.candidates.emptyCopy")}</p></div> : <div className="admin-table-wrap"><table className="admin-table directory"><thead><tr><th>{t("admin.candidates.title")}</th><th>{t("admin.column.status")}</th><th>{t("admin.column.materials")}</th><th>{t("admin.column.knowledge")}</th><th>{t("admin.column.agent")}</th><th>{t("admin.column.created")}</th><th>{t("admin.column.action")}</th></tr></thead><tbody>{data.items.map((candidate) => <tr key={candidate.id}><td data-label={t("admin.candidates.title")}><strong>{candidate.displayName}</strong><small>{candidate.email}</small></td><td data-label={t("admin.column.status")}><span className={`admin-status ${candidate.status}`}>{t(`status.${candidate.status}`)}</span></td><td data-label={t("admin.column.materials")}>{candidate.materialCount}</td><td data-label={t("admin.column.knowledge")}>{candidate.knowledgeCount}</td><td data-label={t("admin.column.agent")}>{candidate.publicationStatus ? <span className={`admin-status ${candidate.publicationStatus}`}>{t(`status.${candidate.publicationStatus}`)}</span> : t("admin.candidates.none")}</td><td data-label={t("admin.column.created")}>{dateLabel(candidate.createdAt, locale)}</td><td data-label={t("admin.column.action")}><button className={candidate.status === "active" ? "admin-row-action danger" : "admin-row-action"} type="button" onClick={() => { setActive(candidate); setDialogError(null); }}>{candidate.status === "active" ? <><Ban size={15} /> {t("admin.candidates.suspend")}</> : <><UserRoundCheck size={15} /> {t("admin.candidates.restore")}</>}</button></td></tr>)}</tbody></table></div>}
      <footer className="admin-pagination"><span>{t("admin.page", { page: data.page, total: data.totalPages })}</span><button type="button" disabled={data.page <= 1} onClick={() => void refresh({ ...filters, page: data.page - 1 })}><ChevronLeft size={16} /> {t("shared.previous")}</button><button type="button" disabled={data.page >= data.totalPages} onClick={() => void refresh({ ...filters, page: data.page + 1 })}>{t("shared.next")} <ChevronRight size={16} /></button></footer>
    </section>
    <aside className="admin-boundary-note"><CheckCircle2 size={18} /><span><strong>{t("admin.candidates.boundaryTitle")}</strong><small>{t("admin.candidates.boundaryCopy")}</small></span></aside>
    {active ? <GovernanceDialog title={t(active.status === "active" ? "admin.candidates.suspendTitle" : "admin.candidates.restoreTitle", { name: active.displayName })} copy={t(active.status === "active" ? "admin.candidates.suspendCopy" : "admin.candidates.restoreCopy")} submitLabel={t(active.status === "active" ? "admin.candidates.suspendSubmit" : "admin.candidates.restoreSubmit")} pending={pending} error={dialogError} locale={locale} onClose={() => { if (!pending) setActive(null); }} onSubmit={changeStatus} /> : null}
  </div>;
}
