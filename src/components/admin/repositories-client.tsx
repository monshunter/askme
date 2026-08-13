"use client";

import { Ban, Github, PlayCircle, RefreshCw, Search, XCircle } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

import { adminRequest } from "./admin-api";
import { GovernanceDialog } from "./governance-dialog";

type Repository = {
  id: string; displayName: string; canonicalUrl: string; visibility: string; disabledAt: string | null; updatedAt: string;
  candidateId: string; candidateName: string; activeCommitSha: string | null; runId: string | null; runPurpose: string | null;
  runState: "pending" | "running" | "completed" | "failed" | "cancelled" | null; runPhase: string | null;
  safeErrorCode: string | null; runUpdatedAt: string | null; toolCalls: number;
};
type RepositoryPage = { items: Repository[]; page: number; pageSize: number; total: number; totalPages: number };
type Filters = { search: string; page: number; pageSize: number };
type Selection = { repository: Repository; action: "disable" | "enable" | "cancel" };

export function AdminRepositoriesClient({ initialPage, initialFilters, locale }: { initialPage: RepositoryPage; initialFilters: Filters; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [data, setData] = useState(initialPage);
  const [filters, setFilters] = useState(initialFilters);
  const [draftSearch, setDraftSearch] = useState(initialFilters.search);
  const [selection, setSelection] = useState<Selection | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refresh(next: Filters) {
    const params = new URLSearchParams({ search: next.search, page: String(next.page), pageSize: String(next.pageSize) });
    setData(await adminRequest<RepositoryPage>(`/api/admin/repositories?${params}`, { cache: "no-store" }));
    setFilters(next);
    window.history.replaceState(null, "", `/admin/repositories?${params}`);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void refresh({ ...filters, search: draftSearch.trim(), page: 1 }).catch(() => setFeedback(t("admin.repositories.searchFailed")));
  }

  async function govern(reason: string) {
    if (!selection) return;
    setPending(true);
    setDialogError(null);
    try {
      if (selection.action === "cancel" && selection.repository.runId) {
        await adminRequest(`/api/admin/analysis-runs/${selection.repository.runId}/cancel`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ reason }) });
      } else {
        await adminRequest(`/api/admin/repositories/${selection.repository.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: selection.action, reason }) });
      }
      await refresh(filters);
      setFeedback(t(`admin.repositories.${selection.action}d` as TranslationKey, { name: selection.repository.displayName }));
      setSelection(null);
    } catch {
      setDialogError(t("admin.repositories.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  async function rerun(repository: Repository) {
    setFeedback(null);
    try {
      await adminRequest(`/api/admin/repositories/${repository.id}/analysis/rerun`, { method: "POST" });
      await refresh(filters);
      setFeedback(t("admin.repositories.rerunQueued", { name: repository.displayName }));
    } catch {
      setFeedback(t("admin.repositories.rerunFailed"));
    }
  }

  return <div className="admin-page">
    <section className="admin-hero compact"><p className="page-kicker">{t("admin.repositories.kicker")}</p><h1>{t("admin.repositories.title")} <span className="title-seal" aria-hidden="true">职问</span></h1><p>{t("admin.repositories.copy")}</p></section>
    {feedback ? <div className="inline-feedback info" role="status">{feedback}<button type="button" onClick={() => setFeedback(null)} aria-label={t("shared.dismiss")}>×</button></div> : null}
    <section className="admin-card admin-directory-card"><header className="admin-directory-header"><div><h2>{t("admin.repositories.directory")}</h2><small>{t("admin.repositories.count", { count: data.total })}</small></div><form onSubmit={search} role="search"><Search size={17} /><input aria-label={t("admin.repositories.searchLabel")} value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder={t("admin.repositories.searchPlaceholder")} /><button>{t("shared.search")}</button></form></header>
      {data.items.length === 0 ? <div className="admin-empty large"><Github size={31} /><h2>{t("admin.repositories.empty")}</h2><p>{t("admin.repositories.emptyCopy")}</p></div> : <div className="admin-table-wrap"><table className="admin-table directory"><thead><tr><th>{t("admin.repositories.repository")}</th><th>{t("admin.repositories.owner")}</th><th>{t("admin.column.status")}</th><th>{t("admin.repositories.revision")}</th><th>{t("admin.repositories.latestRun")}</th><th>{t("admin.column.actions")}</th></tr></thead><tbody>{data.items.map((repository) => <tr key={repository.id}><td data-label={t("admin.repositories.repository")}><strong>{repository.displayName}</strong><small>{repository.canonicalUrl}</small></td><td data-label={t("admin.repositories.owner")}>{repository.candidateName}</td><td data-label={t("admin.column.status")}><span className={`admin-status ${repository.disabledAt ? "disabled" : "active"}`}>{t(repository.disabledAt ? "status.disabled" : "status.active")}</span><small>{repository.visibility}</small></td><td data-label={t("admin.repositories.revision")}><code>{repository.activeCommitSha?.slice(0, 12) ?? "—"}</code></td><td data-label={t("admin.repositories.latestRun")}>{repository.runState ? <><span className={`admin-status ${repository.runState}`}>{t(`status.${repository.runState}` as TranslationKey)}</span><small>{repository.runPhase} · {repository.toolCalls} tools{repository.safeErrorCode ? ` · ${repository.safeErrorCode}` : ""}</small></> : "—"}</td><td data-label={t("admin.column.actions")}><span className="admin-row-actions"><button type="button" className={repository.disabledAt ? "admin-row-action" : "admin-row-action danger"} onClick={() => setSelection({ repository, action: repository.disabledAt ? "enable" : "disable" })}>{repository.disabledAt ? <><PlayCircle size={15} /> {t("admin.repositories.enable")}</> : <><Ban size={15} /> {t("admin.repositories.disable")}</>}</button>{!repository.disabledAt ? <button type="button" className="admin-row-action" onClick={() => void rerun(repository)}><RefreshCw size={15} /> {t("admin.repositories.rerun")}</button> : null}{repository.runId && (repository.runState === "pending" || repository.runState === "running") ? <button type="button" className="admin-row-action danger" onClick={() => setSelection({ repository, action: "cancel" })}><XCircle size={15} /> {t("admin.repositories.cancel")}</button> : null}</span></td></tr>)}</tbody></table></div>}
      <footer className="admin-pagination"><span>{t("admin.page", { page: data.page, total: data.totalPages })}</span><button disabled={data.page <= 1} onClick={() => void refresh({ ...filters, page: data.page - 1 })}>{t("shared.previous")}</button><button disabled={data.page >= data.totalPages} onClick={() => void refresh({ ...filters, page: data.page + 1 })}>{t("shared.next")}</button></footer>
    </section>
    {selection ? <GovernanceDialog title={t(`admin.repositories.${selection.action}Title` as TranslationKey, { name: selection.repository.displayName })} copy={t(`admin.repositories.${selection.action}Copy` as TranslationKey)} submitLabel={t(`admin.repositories.${selection.action}Submit` as TranslationKey)} pending={pending} error={dialogError} locale={locale} onClose={() => { if (!pending) setSelection(null); }} onSubmit={govern} /> : null}
  </div>;
}
