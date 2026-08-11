"use client";

import { Ban, CheckCircle2, ChevronLeft, ChevronRight, Search, UserRoundCheck, UsersRound } from "lucide-react";
import { type FormEvent, useState } from "react";

import { adminRequest } from "./admin-api";
import { GovernanceDialog } from "./governance-dialog";

type Candidate = { id: string; displayName: string; email: string; status: "active" | "suspended"; createdAt: string; updatedAt: string; materialCount: number; knowledgeCount: number; publicationStatus: string | null };
type CandidatePage = { items: Candidate[]; page: number; pageSize: number; total: number; totalPages: number };
type CandidateFilters = { search: string; status: "all" | "active" | "suspended"; page: number; pageSize: number };

function dateLabel(value: string) { return new Date(value).toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" }); }

export function CandidatesClient({ initialPage, initialFilters }: { initialPage: CandidatePage; initialFilters: CandidateFilters }) {
  const [data, setData] = useState(initialPage);
  const [filters, setFilters] = useState(initialFilters);
  const [draftSearch, setDraftSearch] = useState(initialFilters.search);
  const [active, setActive] = useState<Candidate | null>(null);
  const [pending, setPending] = useState(false);
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);

  async function refresh(next: CandidateFilters) {
    const params = new URLSearchParams({ search: next.search, status: next.status, page: String(next.page), pageSize: String(next.pageSize) });
    setData(await adminRequest<CandidatePage>(`/api/admin/candidates?${params}`, { cache: "no-store" })); setFilters(next);
    window.history.replaceState(null, "", `/admin/candidates?${params}`);
  }
  function search(event: FormEvent) { event.preventDefault(); void refresh({ ...filters, search: draftSearch.trim(), page: 1 }).catch((error) => setFeedback(error instanceof Error ? error.message : "Search failed.")); }
  async function changeStatus(reason: string) {
    if (!active) return;
    setPending(true); setDialogError(null);
    const nextStatus = active.status === "active" ? "suspended" : "active";
    try {
      await adminRequest(`/api/admin/candidates/${active.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ status: nextStatus, reason }) });
      await refresh(filters); setActive(null); setFeedback(`${active.displayName} is now ${nextStatus}.`);
    } catch (error) { setDialogError(error instanceof Error ? error.message : "The Candidate status could not be saved."); }
    finally { setPending(false); }
  }
  return <div className="admin-page">
    <section className="admin-hero compact"><p className="page-kicker">Account Governance</p><h1>Candidates <span className="title-seal" aria-hidden="true">问候</span></h1><p>Search Candidate accounts and control platform access without reading private career content.</p></section>
    {feedback ? <div className="inline-feedback info" role="status">{feedback}<button onClick={() => setFeedback(null)} aria-label="Dismiss">×</button></div> : null}
    <section className="admin-card admin-directory-card"><header className="admin-directory-header"><div><h2>Candidate Accounts</h2><small>{data.total.toLocaleString("en-US")} real account{data.total === 1 ? "" : "s"}</small></div><form onSubmit={search} role="search"><Search size={17} /><label className="sr-only" htmlFor="candidate-search">Search Candidates</label><input id="candidate-search" value={draftSearch} maxLength={120} onChange={(event) => setDraftSearch(event.target.value)} placeholder="Name or email" /><button type="submit">Search</button></form><label>Status<select value={filters.status} onChange={(event) => void refresh({ ...filters, status: event.target.value as CandidateFilters["status"], page: 1 }).catch((error) => setFeedback(error instanceof Error ? error.message : "Filter failed."))}><option value="all">All statuses</option><option value="active">Active</option><option value="suspended">Suspended</option></select></label></header>
      {data.items.length === 0 ? <div className="admin-empty large"><UsersRound size={31} /><h2>No Candidates match</h2><p>Change the current search or status filter.</p></div> : <div className="admin-table-wrap"><table className="admin-table directory"><thead><tr><th>Candidate</th><th>Status</th><th>Materials</th><th>Knowledge</th><th>Agent</th><th>Created</th><th>Action</th></tr></thead><tbody>{data.items.map((candidate) => <tr key={candidate.id}><td data-label="Candidate"><strong>{candidate.displayName}</strong><small>{candidate.email}</small></td><td data-label="Status"><span className={`admin-status ${candidate.status}`}>{candidate.status}</span></td><td data-label="Materials">{candidate.materialCount}</td><td data-label="Knowledge">{candidate.knowledgeCount}</td><td data-label="Agent">{candidate.publicationStatus ? <span className={`admin-status ${candidate.publicationStatus}`}>{candidate.publicationStatus}</span> : "None"}</td><td data-label="Created">{dateLabel(candidate.createdAt)}</td><td data-label="Action"><button className={candidate.status === "active" ? "admin-row-action danger" : "admin-row-action"} type="button" onClick={() => { setActive(candidate); setDialogError(null); }}>{candidate.status === "active" ? <><Ban size={15} /> Suspend</> : <><UserRoundCheck size={15} /> Restore</>}</button></td></tr>)}</tbody></table></div>}
      <footer className="admin-pagination"><span>Page {data.page} of {data.totalPages}</span><button type="button" disabled={data.page <= 1} onClick={() => void refresh({ ...filters, page: data.page - 1 })}><ChevronLeft size={16} /> Previous</button><button type="button" disabled={data.page >= data.totalPages} onClick={() => void refresh({ ...filters, page: data.page + 1 })}>Next <ChevronRight size={16} /></button></footer>
    </section>
    <aside className="admin-boundary-note"><CheckCircle2 size={18} /><span><strong>Private source boundary enforced</strong><small>This page receives account and aggregate counts only—never Source Material, Chunk, or message content.</small></span></aside>
    {active ? <GovernanceDialog title={`${active.status === "active" ? "Suspend" : "Restore"} ${active.displayName}`} copy={active.status === "active" ? "Current sessions will be revoked and public Agent access will stop immediately." : "The account can sign in again; previous sessions remain revoked."} submitLabel={active.status === "active" ? "Suspend Candidate" : "Restore Candidate"} pending={pending} error={dialogError} onClose={() => { if (!pending) setActive(null); }} onSubmit={changeStatus} /> : null}
  </div>;
}
