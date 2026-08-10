"use client";

import { AlertCircle, ArrowLeft, ArrowRight, BookOpen, Check, ChevronDown, FileText, Grid2X2, List, LoaderCircle, LockKeyhole, Pencil, Quote, Search, ShieldCheck, Sparkles, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";

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

const categories: Array<{ type: KnowledgeType | null; label: string; countKey: string }> = [
  { type: null, label: "All", countKey: "all" },
  { type: "project", label: "Projects", countKey: "project" },
  { type: "experience", label: "Experience", countKey: "experience" },
  { type: "skill", label: "Skills", countKey: "skill" },
  { type: "article", label: "Articles", countKey: "article" },
  { type: "repository", label: "Repositories", countKey: "repository" },
  { type: "summary", label: "Summaries", countKey: "summary" },
];

function typeLabel(type: KnowledgeType) {
  return type[0]!.toUpperCase() + type.slice(1);
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
}

function requestFailureMessage(error: unknown, action: string) {
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? `The ${action} returned an invalid response.`
    : `The ${action} connection failed. Try again.`;
}

export function KnowledgeClient({ initialKnowledge, initialSearch }: { initialKnowledge: KnowledgePage; initialSearch: string }) {
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
          setFeedback(payload.error?.message ?? "Knowledge could not be loaded.");
          return;
        }
        if (!payload.data) throw new ApiClientError("invalid_response");
        setKnowledge(payload.data);
        const nextSelected = payload.data.items.some((item) => item.id === selectedId) ? selectedId : payload.data.items[0]?.id ?? null;
        setSelectedId(nextSelected);
        if (!nextSelected) setDetail(null);
      } catch (error) {
        setFeedback(requestFailureMessage(error, "knowledge list"));
      } finally {
        setLoading(false);
      }
    },
    [citation, search, selectedId, status, type],
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
          setFeedback(payload.error?.message ?? "Knowledge detail could not be loaded.");
        }
      })
      .catch((error) => {
        if (!active) return;
        setSelectedId(null);
        setDetail(null);
        setFeedback(requestFailureMessage(error, "knowledge detail"));
      });
    return () => {
      active = false;
    };
  }, [selectedId]);

  async function saveEdit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!detail) return;
    const form = new FormData(event.currentTarget);
    try {
      const { response, payload } = await requestApi<ApiEnvelope>(`/api/knowledge/${detail.id}`, {
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
        setFeedback(payload.error?.message ?? "The knowledge item could not be saved.");
        return;
      }
      setEditing(false);
      setFeedback(null);
      await loadList(knowledge.page);
      const refreshed = await requestApi<ApiEnvelope<KnowledgeDetail>>(`/api/knowledge/${detail.id}`, { cache: "no-store" });
      if (!refreshed.response.ok || !refreshed.payload.data) throw new ApiClientError("invalid_response");
      setDetail(refreshed.payload.data);
    } catch (error) {
      setFeedback(requestFailureMessage(error, "knowledge update"));
    }
  }

  const confidenceLabel = useCallback((confidence: number) => (confidence >= 0.9 ? "High" : confidence >= 0.75 ? "Med–High" : confidence >= 0.5 ? "Medium" : "Review"), []);
  const pageNumbers = useMemo(() => {
    const start = Math.max(1, Math.min(knowledge.page - 2, knowledge.totalPages - 4));
    return Array.from({ length: Math.min(5, knowledge.totalPages) }, (_, index) => start + index);
  }, [knowledge.page, knowledge.totalPages]);

  return (
    <div className="candidate-page knowledge-page">
      <section className="page-hero knowledge-hero">
        <p className="page-kicker">Career Evidence</p>
        <h1>Career Knowledge Base <span className="title-seal" aria-hidden="true">问候</span></h1>
        <p>AI-organized knowledge from your materials. Owned by you, not directly shared with interviewers.</p>
        <span className="private-badge"><LockKeyhole size={14} /> Private to you</span>
      </section>

      <div className="category-tabs" role="tablist" aria-label="Knowledge categories">
        {categories.map((category) => (
          <button
            type="button"
            role="tab"
            aria-selected={type === category.type}
            className={type === category.type ? "active" : ""}
            key={category.label}
            onClick={() => {
              setType(category.type);
              void loadList(1, { nextType: category.type });
            }}
          >
            {category.label}<span>{knowledge.counts[category.countKey] ?? 0}</span>
          </button>
        ))}
      </div>

      {feedback ? <div className="inline-feedback error" role="alert"><AlertCircle size={18} />{feedback}<button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss"><X size={16} /></button></div> : null}

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
              <Search size={18} /><label className="sr-only" htmlFor="knowledge-search">Search knowledge</label><input id="knowledge-search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search knowledge, sources, and evidence..." /><button type="submit">Search</button>
            </form>
            <label>State<select value={status} onChange={(event) => { const nextStatus = event.target.value as "active" | "archived"; setStatus(nextStatus); void loadList(1, { nextStatus }); }}><option value="active">Active</option><option value="archived">Archived</option></select><ChevronDown size={14} /></label>
            <label>Citations<select value={citation} onChange={(event) => { const nextCitation = event.target.value as "all" | "ready" | "private"; setCitation(nextCitation); void loadList(1, { nextCitation }); }}><option value="all">All</option><option value="ready">Ready</option><option value="private">Not ready</option></select><ChevronDown size={14} /></label>
            <div className="view-toggle" aria-label="View style"><button className={view === "list" ? "active" : ""} type="button" onClick={() => setView("list")} aria-label="List view"><List size={18} /></button><button className={view === "grid" ? "active" : ""} type="button" onClick={() => setView("grid")} aria-label="Grid view"><Grid2X2 size={17} /></button></div>
          </div>
          <p className="result-count">{knowledge.total.toLocaleString("en-US")} item{knowledge.total === 1 ? "" : "s"}</p>

          {loading ? <div className="loading-state"><LoaderCircle className="spin" size={26} /> Loading knowledge…</div> : knowledge.items.length === 0 ? (
            <div className="empty-state large"><BookOpen size={35} /><h2>No matching knowledge</h2><p>Try another category or add a source material with relevant evidence.</p></div>
          ) : view === "list" ? (
            <div className="knowledge-table" role="table" aria-label="Knowledge items">
              <div className="knowledge-table-header" role="row"><span>Title</span><span>Type</span><span>Sources</span><span>Index / Confidence</span><span>Last Updated</span><span>Visibility</span></div>
              {knowledge.items.map((item) => (
                <button className={selectedId === item.id ? "knowledge-row selected" : "knowledge-row"} type="button" role="row" key={item.id} onClick={() => { setSelectedId(item.id); setEditing(false); }}>
                  <span className="knowledge-title"><i><FileText size={17} /></i><span><strong>{item.title}</strong><small>{item.summary}</small></span></span>
                  <span><em className={`type-pill ${item.type}`}>{typeLabel(item.type)}</em></span>
                  <span data-label="Sources">{item.sourceCount}</span>
                  <span data-label="Confidence"><em className="confidence-pill">{confidenceLabel(item.confidence)}</em> {Math.round(item.confidence * 100)}%</span>
                  <span data-label="Updated">{formatDate(item.updatedAt)}</span>
                  <span data-label="Visibility">{item.citationReady ? <><ShieldCheck size={14} /> Citation ready</> : <><LockKeyhole size={14} /> Private</>}</span>
                </button>
              ))}
            </div>
          ) : (
            <div className="knowledge-grid">
              {knowledge.items.map((item) => <button type="button" key={item.id} className={selectedId === item.id ? "selected" : ""} onClick={() => setSelectedId(item.id)}><span><em className={`type-pill ${item.type}`}>{typeLabel(item.type)}</em><small>{Math.round(item.confidence * 100)}%</small></span><strong>{item.title}</strong><p>{item.summary}</p><small>{item.sourceCount} source{item.sourceCount === 1 ? "" : "s"}</small></button>)}
            </div>
          )}

          {knowledge.totalPages > 1 ? <nav className="pagination" aria-label="Knowledge pages"><button type="button" disabled={knowledge.page === 1} onClick={() => void loadList(knowledge.page - 1)}><ArrowLeft size={16} /></button>{pageNumbers.map((page) => <button className={page === knowledge.page ? "active" : ""} type="button" key={page} onClick={() => void loadList(page)}>{page}</button>)}<button type="button" disabled={knowledge.page === knowledge.totalPages} onClick={() => void loadList(knowledge.page + 1)}><ArrowRight size={16} /></button></nav> : null}
        </section>

        <aside className="knowledge-detail" aria-live="polite">
          {detailLoading ? <div className="loading-state"><LoaderCircle className="spin" size={24} /> Loading detail…</div> : !detail ? <div className="empty-state large"><BookOpen size={32} /><p>Select a knowledge item to inspect its sources.</p></div> : editing ? (
            <form className="knowledge-edit-form" onSubmit={saveEdit}>
              <div className="section-heading"><h2>Edit knowledge</h2><button className="icon-button" type="button" onClick={() => setEditing(false)} aria-label="Close editor"><X size={17} /></button></div>
              <label htmlFor="edit-title">Title</label><input id="edit-title" name="title" defaultValue={detail.title} required maxLength={300} />
              <label htmlFor="edit-type">Category</label><select id="edit-type" name="type" defaultValue={detail.type}>{categories.filter((category) => category.type).map((category) => <option key={category.type!} value={category.type!}>{category.label}</option>)}</select>
              <label htmlFor="edit-summary">Summary</label><textarea id="edit-summary" name="summary" defaultValue={detail.summary} rows={7} required maxLength={4000} />
              <label htmlFor="edit-highlights">Highlights <small>One per line</small></label><textarea id="edit-highlights" name="highlights" defaultValue={detail.highlights.join("\n")} rows={6} />
              <div><button className="secondary-button" type="button" onClick={() => setEditing(false)}>Cancel</button><button className="primary-button" type="submit"><Check size={16} /> Save changes</button></div>
            </form>
          ) : (
            <>
              <div className="detail-heading"><em className={`type-pill ${detail.type}`}>{typeLabel(detail.type)}</em><button type="button" onClick={() => setEditing(true)}><Pencil size={15} /> Edit</button><h2>{detail.title}</h2><p><LockKeyhole size={14} /> {detail.citationReady ? "Citation ready" : "Private evidence"}</p></div>
              <div className="detail-tabs"><span className="active">Overview</span><span>Sources ({detail.sources.length})</span><span>Evidence ({detail.evidence.length})</span></div>
              <section className="detail-section"><h3>Summary <Sparkles size={15} /></h3><p>{detail.summary}</p></section>
              <section className="detail-section"><h3>Key Highlights</h3>{detail.highlights.length === 0 ? <p className="muted">No highlights were extracted.</p> : <ul className="highlight-list">{detail.highlights.map((highlight, index) => <li key={`${highlight}-${index}`}><Check size={14} />{highlight}</li>)}</ul>}</section>
              <section className="detail-section"><h3>Sources <span>{detail.sources.length}</span></h3><ul className="source-list">{detail.sources.map((source) => <li key={source.id}><span className="file-tile"><FileText size={15} /></span><span><strong>{source.title}</strong><small>{source.kind.toUpperCase()} · {source.chunkCount} chunks · {source.visibility.replaceAll("_", " ")}</small></span></li>)}</ul></section>
              <section className="detail-section citation-readiness"><h3>Citation Readiness</h3><div><span className={detail.citationReady ? "ready" : "private"}>{detail.citationReady ? <Quote size={24} /> : <LockKeyhole size={24} />}<strong>{detail.citationReady ? "Ready" : "Private"}</strong></span><p>{detail.citationReady ? `Supported by ${detail.chunkCount} evidence chunks from allowed sources.` : "Change source privacy before this evidence can support public answers."}</p></div></section>
            </>
          )}
        </aside>
      </div>
      <footer className="candidate-footer"><span>© 2026 Askme. All rights reserved.</span><span>Privacy · Terms · Support</span><span>English</span></footer>
    </div>
  );
}
