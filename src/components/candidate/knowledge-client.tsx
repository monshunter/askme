"use client";

import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, FileText, Grid2X2, List, LoaderCircle, LockKeyhole, Pencil, Quote, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

import { ApiClientError, requestApi } from "./api-client";

type KnowledgeType = "project" | "experience" | "skill" | "article" | "repository" | "summary";
type KnowledgeItem = {
  id: string;
  type: KnowledgeType;
  status: "active" | "archived";
  title: string;
  summary: string;
  highlights: string[];
  confidence: number;
  sourceCount: number;
  chunkCount: number;
  sourceTitles: string[];
  sourceVisibilities: string[];
  citationReady: boolean;
  updatedAt: string;
};
type KnowledgePage = { items: KnowledgeItem[]; counts: Record<string, number>; page: number; pageSize: number; total: number; totalPages: number };
type Source = { id: string; title: string; kind: string; status: string; visibility: string; externalUrl: string | null; summary: string | null; chunkCount: number; updatedAt: string };
type Evidence = { id: string; materialId: string; position: number; excerpt: string };
type KnowledgeDetail = KnowledgeItem & { sources: Source[]; evidence: Evidence[] };
type ApiEnvelope<T = unknown> = { data?: T; error?: { message?: string } | null };

const categories: Array<{ type: KnowledgeType | null; labelKey: TranslationKey; countKey: string }> = [
  { type: null, labelKey: "knowledge.category.all", countKey: "all" },
  { type: "project", labelKey: "knowledge.category.projects", countKey: "project" },
  { type: "experience", labelKey: "knowledge.category.experience", countKey: "experience" },
  { type: "skill", labelKey: "knowledge.category.skills", countKey: "skill" },
  { type: "article", labelKey: "knowledge.category.articles", countKey: "article" },
  { type: "repository", labelKey: "knowledge.category.repositories", countKey: "repository" },
  { type: "summary", labelKey: "knowledge.category.summaries", countKey: "summary" },
];

const typeKeys: Record<KnowledgeType, TranslationKey> = {
  project: "knowledge.type.project", experience: "knowledge.type.experience", skill: "knowledge.type.skill", article: "knowledge.type.article", repository: "knowledge.type.repository", summary: "knowledge.type.summary",
};

function typeLabel(type: KnowledgeType, locale: Locale) {
  return createTranslator(locale)(typeKeys[type]);
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
}

function requestFailureMessage(error: unknown, action: string, locale: Locale) {
  const t = createTranslator(locale);
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? t("knowledge.connectionInvalid", { action })
    : t("knowledge.connectionFailed", { action });
}

export function KnowledgeClient({ initialKnowledge, initialSearch, locale }: { initialKnowledge: KnowledgePage; initialSearch: string; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [knowledge, setKnowledge] = useState(initialKnowledge);
  const [type, setType] = useState<KnowledgeType | null>(null);
  const [search, setSearch] = useState(initialSearch);
  const [status, setStatus] = useState<"active" | "archived">("active");
  const [citation, setCitation] = useState<"all" | "ready" | "private">("all");
  const [selectedId, setSelectedId] = useState<string | null>(initialKnowledge.items[0]?.id ?? null);
  const [detail, setDetail] = useState<KnowledgeDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [view, setView] = useState<"list" | "grid">("list");
  const detailLoading = Boolean(selectedId && detail?.id !== selectedId);

  const loadList = useCallback(
    async (page = 1, overrides: { nextType?: KnowledgeType | null; nextSearch?: string; nextStatus?: "active" | "archived"; nextCitation?: "all" | "ready" | "private" } = {}) => {
      const activeType = overrides.nextType !== undefined ? overrides.nextType : type;
      const activeSearch = overrides.nextSearch !== undefined ? overrides.nextSearch : search;
      const activeStatus = overrides.nextStatus ?? status;
      const activeCitation = overrides.nextCitation ?? citation;
      const params = new URLSearchParams({ page: String(page), pageSize: "20", status: activeStatus });
      if (activeType) params.set("type", activeType);
      if (activeSearch.trim()) params.set("search", activeSearch.trim());
      if (activeCitation !== "all") params.set("citationReady", activeCitation === "ready" ? "true" : "false");
      setLoading(true);
      setFeedback(null);
      try {
        const { response, payload } = await requestApi<ApiEnvelope<KnowledgePage>>(`/api/knowledge?${params}`, { cache: "no-store" });
        if (!response.ok) {
          setFeedback(t("knowledge.loadFailed"));
          return;
        }
        if (!payload.data) throw new ApiClientError("invalid_response");
        setKnowledge(payload.data);
        const nextSelected = payload.data.items.some((item) => item.id === selectedId) ? selectedId : payload.data.items[0]?.id ?? null;
        setSelectedId(nextSelected);
        if (!nextSelected) setDetail(null);
      } catch (error) {
        setFeedback(requestFailureMessage(error, t("knowledge.action.list"), locale));
      } finally {
        setLoading(false);
      }
    },
    [citation, locale, search, selectedId, status, t, type],
  );

  useEffect(() => {
    if (!selectedId) return;
    let active = true;
    void requestApi<ApiEnvelope<KnowledgeDetail>>(`/api/knowledge/${selectedId}`, { cache: "no-store" })
      .then(({ response, payload }) => {
        if (!active) return;
        if (response.ok && payload.data) setDetail(payload.data);
        else {
          setSelectedId(null);
          setDetail(null);
          setFeedback(t("knowledge.detailFailed"));
        }
      })
      .catch((error) => {
        if (!active) return;
        setSelectedId(null);
        setDetail(null);
        setFeedback(requestFailureMessage(error, t("knowledge.action.detail"), locale));
      });
    return () => {
      active = false;
    };
  }, [locale, selectedId, t]);

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    try {
      const { response } = await requestApi<ApiEnvelope>(`/api/knowledge/${detail.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          title: String(form.get("title") ?? ""),
          type: String(form.get("type") ?? ""),
          summary: String(form.get("summary") ?? ""),
          highlights: String(form.get("highlights") ?? "").split("\n").map((line) => line.trim()).filter(Boolean),
        }),
      });
      if (!response.ok) {
        setFeedback(t("knowledge.saveFailed"));
        return;
      }
      setEditing(false);
      setFeedback(null);
      await loadList(knowledge.page);
      const refreshed = await requestApi<ApiEnvelope<KnowledgeDetail>>(`/api/knowledge/${detail.id}`, { cache: "no-store" });
      if (!refreshed.response.ok || !refreshed.payload.data) throw new ApiClientError("invalid_response");
      setDetail(refreshed.payload.data);
    } catch (error) {
      setFeedback(requestFailureMessage(error, t("knowledge.action.update"), locale));
    }
  }

  const confidenceLabel = useCallback((confidence: number) => (confidence >= 0.9 ? t("knowledge.confidence.high") : confidence >= 0.75 ? t("knowledge.confidence.medHigh") : confidence >= 0.5 ? t("knowledge.confidence.medium") : t("knowledge.confidence.review")), [t]);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(knowledge.page - 2, knowledge.totalPages - 4));
    return Array.from({ length: Math.min(5, knowledge.totalPages) }, (_, index) => start + index);
  }, [knowledge.page, knowledge.totalPages]);

  return (
    <div className="candidate-page knowledge-page">
      <section className="page-hero knowledge-hero">
        <p className="page-kicker">{t("knowledge.kicker")}</p>
        <h1>{t("knowledge.title")} <span className="title-seal" aria-hidden="true">职问</span></h1>
        <p>{t("knowledge.copy")}</p>
        <span className="private-badge"><LockKeyhole size={14} /> {t("knowledge.private")}</span>
      </section>

      <div className="category-tabs" role="tablist" aria-label={t("knowledge.categories")}>
        {categories.map((category) => (
          <button
            type="button"
            role="tab"
            aria-selected={type === category.type}
            className={type === category.type ? "active" : ""}
            key={category.labelKey}
            onClick={() => {
              setType(category.type);
              void loadList(1, { nextType: category.type });
            }}
          >
            {t(category.labelKey)}<span>{knowledge.counts[category.countKey] ?? 0}</span>
          </button>
        ))}
      </div>

      {feedback ? <div className="inline-feedback error" role="alert"><AlertCircle size={18} />{feedback}<button type="button" onClick={() => setFeedback(null)} aria-label={t("shared.dismiss")}><X size={16} /></button></div> : null}

      <div className="knowledge-workspace">
        <section className="knowledge-browser">
          <div className="knowledge-toolbar">
            <form
              className="knowledge-search"
              onSubmit={(event) => {
                event.preventDefault();
                void loadList(1);
              }}
            >
              <Search size={18} /><label className="sr-only" htmlFor="knowledge-search">{t("knowledge.search.label")}</label><input id="knowledge-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t("knowledge.search.placeholder")} /><button type="submit">{t("shared.search")}</button>
            </form>
            <label>{t("knowledge.filter.state")}<select value={status} onChange={(event) => { const nextStatus = event.target.value as "active" | "archived"; setStatus(nextStatus); void loadList(1, { nextStatus }); }}><option value="active">{t("status.active")}</option><option value="archived">{t("status.archived")}</option></select><ChevronDown size={14} /></label>
            <label>{t("knowledge.filter.citations")}<select value={citation} onChange={(event) => { const nextCitation = event.target.value as "all" | "ready" | "private"; setCitation(nextCitation); void loadList(1, { nextCitation }); }}><option value="all">{t("knowledge.filter.all")}</option><option value="ready">{t("knowledge.filter.ready")}</option><option value="private">{t("knowledge.filter.notReady")}</option></select><ChevronDown size={14} /></label>
            <div className="view-toggle" aria-label={t("knowledge.view.label")}><button className={view === "list" ? "active" : ""} type="button" onClick={() => setView("list")} aria-label={t("knowledge.view.list")}><List size={18} /></button><button className={view === "grid" ? "active" : ""} type="button" onClick={() => setView("grid")} aria-label={t("knowledge.view.grid")}><Grid2X2 size={17} /></button></div>
          </div>
          <p className="result-count">{t("knowledge.resultCount", { count: knowledge.total.toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US") })}</p>

          {loading ? <div className="loading-state"><LoaderCircle className="spin" size={26} /> {t("knowledge.loading")}</div> : knowledge.items.length === 0 ? (
            <div className="empty-state large"><BookOpen size={35} /><h2>{t("knowledge.empty.title")}</h2><p>{t("knowledge.empty.copy")}</p></div>
          ) : view === "list" ? (
            <div className="knowledge-table" role="table" aria-label={t("knowledge.table.label")}>
              <div className="knowledge-table-header" role="row"><span>{t("knowledge.table.title")}</span><span>{t("knowledge.table.type")}</span><span>{t("knowledge.table.sources")}</span><span>{t("knowledge.table.confidence")}</span><span>{t("knowledge.table.updated")}</span><span>{t("knowledge.table.visibility")}</span></div>
              {knowledge.items.map((item) => (
                <button className={selectedId === item.id ? "knowledge-row selected" : "knowledge-row"} type="button" role="row" key={item.id} onClick={() => { setSelectedId(item.id); setEditing(false); }}>
                  <span className="knowledge-title"><i><FileText size={17} /></i><span><strong>{item.title}</strong><small>{item.summary}</small></span></span>
                  <span><em className={`type-pill ${item.type}`}>{typeLabel(item.type, locale)}</em></span>
                  <span data-label={t("knowledge.table.sources")}>{item.sourceCount}</span>
                  <span data-label={t("knowledge.table.confidence")}><em className="confidence-pill">{confidenceLabel(item.confidence)}</em> {Math.round(item.confidence * 100)}%</span>
                  <span data-label={t("knowledge.table.updated")}>{formatDate(item.updatedAt, locale)}</span>
                  <span data-label={t("knowledge.table.visibility")}>{item.citationReady ? <><ShieldCheck size={14} /> {t("knowledge.citationReady")}</> : <><LockKeyhole size={14} /> {t("knowledge.private")}</>}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="knowledge-grid">
              {knowledge.items.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}><span><em className={`type-pill ${item.type}`}>{typeLabel(item.type, locale)}</em><small>{Math.round(item.confidence * 100)}%</small></span><strong>{item.title}</strong><p>{item.summary}</p><small>{t("knowledge.sourceCount", { count: item.sourceCount })}</small></button>)}
            </div>
          )}

          {knowledge.totalPages > 1 ? <nav className="pagination" aria-label={t("knowledge.pages")}><button type="button" disabled={knowledge.page === 1} onClick={() => void loadList(knowledge.page - 1)} aria-label={t("shared.previous")}><ArrowLeft size={16} /></button>{pageNumbers.map((page) => <button className={page === knowledge.page ? "active" : ""} type="button" key={page} onClick={() => void loadList(page)}>{page}</button>)}<button type="button" disabled={knowledge.page === knowledge.totalPages} onClick={() => void loadList(knowledge.page + 1)} aria-label={t("shared.next")}><ArrowRight size={16} /></button></nav> : null}
        </section>

        <aside className="knowledge-detail" aria-live="polite">
          {detailLoading ? <div className="loading-state"><LoaderCircle className="spin" size={24} /> {t("knowledge.detail.loading")}</div> : !detail ? <div className="empty-state large"><BookOpen size={32} /><p>{t("knowledge.detail.select")}</p></div> : editing ? (
            <form className="knowledge-edit-form" onSubmit={saveEdit}>
              <div className="section-heading"><h2>{t("knowledge.edit.title")}</h2><button className="icon-button" type="button" onClick={() => setEditing(false)} aria-label={t("knowledge.edit.close")}><X size={17} /></button></div>
              <label htmlFor="edit-title">{t("knowledge.edit.fieldTitle")}</label><input id="edit-title" name="title" defaultValue={detail.title} required maxLength={300} />
              <label htmlFor="edit-type">{t("knowledge.edit.category")}</label><select id="edit-type" name="type" defaultValue={detail.type}>{categories.filter((category) => category.type).map((category) => <option key={category.type!} value={category.type!}>{t(category.labelKey)}</option>)}</select>
              <label htmlFor="edit-summary">{t("knowledge.edit.summary")}</label><textarea id="edit-summary" name="summary" defaultValue={detail.summary} rows={7} required maxLength={4000} />
              <label htmlFor="edit-highlights">{t("knowledge.edit.highlights")} <small>{t("knowledge.edit.onePerLine")}</small></label><textarea id="edit-highlights" name="highlights" defaultValue={detail.highlights.join("\n")} rows={6} />
              <div><button className="secondary-button" type="button" onClick={() => setEditing(false)}>{t("shared.cancel")}</button><button className="primary-button" type="submit"><Check size={16} /> {t("knowledge.edit.save")}</button></div>
            </form>
          ) : (
            <>
              <div className="detail-heading"><em className={`type-pill ${detail.type}`}>{typeLabel(detail.type, locale)}</em><button type="button" onClick={() => setEditing(true)}><Pencil size={15} /> {t("knowledge.detail.edit")}</button><h2>{detail.title}</h2><p><LockKeyhole size={14} /> {detail.citationReady ? t("knowledge.citationReady") : t("knowledge.privateEvidence")}</p></div>
              <div className="detail-tabs"><span className="active">{t("knowledge.detail.overview")}</span><span>{t("knowledge.detail.sources", { count: detail.sources.length })}</span><span>{t("knowledge.detail.evidence", { count: detail.evidence.length })}</span></div>
              <section className="detail-section"><h3>{t("knowledge.detail.summary")} <Sparkles size={15} /></h3><p>{detail.summary}</p></section>
              <section className="detail-section"><h3>{t("knowledge.detail.highlights")}</h3>{detail.highlights.length === 0 ? <p className="muted">{t("knowledge.detail.noHighlights")}</p> : <ul className="highlight-list">{detail.highlights.map((highlight, index) => <li key={`${highlight}-${index}`}><Check size={14} />{highlight}</li>)}</ul>}</section>
              <section className="detail-section"><h3>{t("knowledge.detail.sourcesTitle")} <span>{detail.sources.length}</span></h3><ul className="source-list">{detail.sources.map((source) => <li key={source.id}><span className="file-tile"><FileText size={15} /></span><span><strong>{source.title}</strong><small>{t("knowledge.detail.sourceMeta", { kind: source.kind.toUpperCase(), count: source.chunkCount, visibility: source.visibility.replaceAll("_", " ") })}</small></span></li>)}</ul></section>
              <section className="detail-section citation-readiness"><h3>{t("knowledge.readiness.title")}</h3><div><span className={detail.citationReady ? "ready" : "private"}>{detail.citationReady ? <Quote size={24} /> : <LockKeyhole size={24} />}<strong>{detail.citationReady ? t("status.ready") : t("knowledge.private")}</strong></span><p>{detail.citationReady ? t("knowledge.readiness.supported", { count: detail.chunkCount }) : t("knowledge.readiness.private")}</p></div></section>
            </>
          )}
        </aside>
      </div>
      <footer className="candidate-footer"><span>{t("shared.footerRights")}</span><span>{t("shared.footerLinks")}</span></footer>
    </div>
  );
}
