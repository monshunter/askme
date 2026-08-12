"use client";

import { CheckCircle2, Eye, FileSearch, Search, ShieldCheck, XCircle } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { createTranslator, type Locale } from "@/i18n/core";

import { adminRequest } from "./admin-api";
import { GovernanceDialog } from "./governance-dialog";

type Review = { id: string; category: string; severity: "low" | "medium" | "high"; status: "open" | "reviewing" | "resolved" | "dismissed"; safeSummary: string; decisionNote: string | null; reviewedAt: string | null; createdAt: string; updatedAt: string; publicationId: string | null; slug: string | null; publicationStatus: string | null; displayName: string | null; reviewedByName: string | null };
type ReviewPage = { items: Review[]; page: number; pageSize: number; total: number; totalPages: number };
type Filters = { search: string; status: "all" | Review["status"]; severity: "all" | Review["severity"]; page: number; pageSize: number };
type ReviewAction = "review" | "resolve" | "dismiss";

export function ReviewsClient({ initialPage, initialFilters, locale }: { initialPage: ReviewPage; initialFilters: Filters; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [data, setData] = useState(initialPage);
  const [filters, setFilters] = useState(initialFilters);
  const [draftSearch, setDraftSearch] = useState(initialFilters.search);
  const [selection, setSelection] = useState<{ review: Review; action: ReviewAction } | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refresh(next: Filters) {
    const params = new URLSearchParams({ search: next.search, status: next.status, severity: next.severity, page: String(next.page), pageSize: String(next.pageSize) });
    setData(await adminRequest<ReviewPage>(`/api/admin/reviews?${params}`, { cache: "no-store" }));
    setFilters(next);
    window.history.replaceState(null, "", `/admin/reviews?${params}`);
  }

  function search(event: FormEvent) {
    event.preventDefault();
    void refresh({ ...filters, search: draftSearch.trim(), page: 1 }).catch(() => setFeedback(t("admin.reviews.searchFailed")));
  }

  async function decide(note: string) {
    if (!selection) return;
    setPending(true);
    setDialogError(null);
    try {
      await adminRequest(`/api/admin/reviews/${selection.review.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action: selection.action, note }) });
      await refresh(filters);
      const status = selection.action === "review" ? "reviewing" : selection.action === "resolve" ? "resolved" : "dismissed";
      setFeedback(t("admin.reviews.changed", { status: t(`status.${status}`) }));
      setSelection(null);
    } catch {
      setDialogError(t("admin.reviews.saveFailed"));
    } finally {
      setPending(false);
    }
  }

  const actionLabel = (action: ReviewAction) => t(action === "review" ? "admin.reviews.review" : action === "resolve" ? "admin.reviews.resolve" : "admin.reviews.dismiss");
  return <div className="admin-page">
    <section className="admin-hero compact"><p className="page-kicker">{t("admin.reviews.kicker")}</p><h1>{t("admin.reviews.title")} <span className="title-seal" aria-hidden="true">职问</span></h1><p>{t("admin.reviews.copy")}</p></section>
    {feedback ? <div className="inline-feedback info" role="status">{feedback}<button type="button" onClick={() => setFeedback(null)} aria-label={t("shared.dismiss")}>×</button></div> : null}
    <section className="admin-card admin-directory-card"><header className="admin-directory-header review-filters"><div><h2>{t("admin.reviews.queue")}</h2><small>{t("admin.reviews.count", { count: data.total })}</small></div><form onSubmit={search}><Search size={17} /><input aria-label={t("admin.reviews.searchLabel")} value={draftSearch} onChange={(event) => setDraftSearch(event.target.value)} placeholder={t("admin.reviews.searchPlaceholder")} /><button>{t("shared.search")}</button></form><label>{t("admin.column.status")}<select value={filters.status} onChange={(event) => void refresh({ ...filters, status: event.target.value as Filters["status"], page: 1 })}><option value="all">{t("admin.reviews.all")}</option><option value="open">{t("status.open")}</option><option value="reviewing">{t("status.reviewing")}</option><option value="resolved">{t("status.resolved")}</option><option value="dismissed">{t("status.dismissed")}</option></select></label><label>{t("admin.reviews.severity")}<select value={filters.severity} onChange={(event) => void refresh({ ...filters, severity: event.target.value as Filters["severity"], page: 1 })}><option value="all">{t("admin.reviews.all")}</option><option value="high">{t("status.high")}</option><option value="medium">{t("status.medium")}</option><option value="low">{t("status.low")}</option></select></label></header>
      {data.items.length === 0 ? <div className="admin-empty large"><FileSearch size={31} /><h2>{t("admin.reviews.empty")}</h2><p>{t("admin.reviews.emptyCopy")}</p></div> : <div className="admin-review-list">{data.items.map((review) => <article key={review.id}><span className={`admin-risk-icon ${review.severity}`}><ShieldCheck size={20} /></span><div className="admin-review-copy"><header><strong>{review.category.replaceAll("_", " ")}</strong><span className={`admin-status ${review.severity}`}>{t(`status.${review.severity}`)}</span><span className={`admin-status ${review.status}`}>{t(`status.${review.status}`)}</span></header><p>{review.safeSummary}</p><small>{review.displayName ?? t("admin.unavailableAgent")} · {t("admin.reviews.detected", { date: new Date(review.createdAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" }) })}</small>{review.decisionNote ? <blockquote><strong>{review.reviewedByName ?? t("admin.reviews.formerAdmin")}</strong> · {review.decisionNote}</blockquote> : null}</div>{review.status === "open" || review.status === "reviewing" ? <div className="admin-review-actions">{review.status === "open" ? <button type="button" onClick={() => setSelection({ review, action: "review" })}><Eye size={15} /> {t("admin.reviews.review")}</button> : null}<button type="button" onClick={() => setSelection({ review, action: "resolve" })}><CheckCircle2 size={15} /> {t("admin.reviews.resolve")}</button><button type="button" onClick={() => setSelection({ review, action: "dismiss" })}><XCircle size={15} /> {t("admin.reviews.dismiss")}</button></div> : null}</article>)}</div>}
      <footer className="admin-pagination"><span>{t("admin.page", { page: data.page, total: data.totalPages })}</span><button disabled={data.page <= 1} onClick={() => void refresh({ ...filters, page: data.page - 1 })}>{t("shared.previous")}</button><button disabled={data.page >= data.totalPages} onClick={() => void refresh({ ...filters, page: data.page + 1 })}>{t("shared.next")}</button></footer>
    </section>
    {selection ? <GovernanceDialog title={t("admin.reviews.dialogTitle", { action: actionLabel(selection.action), category: selection.review.category.replaceAll("_", " ") })} copy={t("admin.reviews.dialogCopy")} submitLabel={t(selection.action === "review" ? "admin.reviews.markReviewing" : selection.action === "resolve" ? "admin.reviews.resolveItem" : "admin.reviews.dismissItem")} pending={pending} error={dialogError} locale={locale} onClose={() => { if (!pending) setSelection(null); }} onSubmit={decide} /> : null}
  </div>;
}
