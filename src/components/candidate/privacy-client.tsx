"use client";

import { AlertCircle, BookOpen, Check, ChevronDown, Eye, FileText, Github, Globe2, Link2, LoaderCircle, LockKeyhole, Plus, Quote, RefreshCw, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useState } from "react";

import { ApiClientError, requestApi } from "./api-client";

type Visibility = "private" | "agent_only" | "citation_allowed" | "public_preview";
type Material = {
  id: string;
  title: string;
  kind: "file" | "github" | "notion" | "website";
  status: "queued" | "processing" | "indexed" | "failed";
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
};
type PreviewMaterial = Pick<Material, "id" | "title" | "kind" | "status" | "visibility" | "updatedAt">;
type PrivacyOverview = {
  materials: { items: Material[]; page: number; pageSize: number; total: number; totalPages: number };
  counts: { private: number; agentOnly: number; citationAllowed: number; publicPreview: number; interviewerAccessible: number; interviewerHidden: number };
  preview: { accessible: PreviewMaterial[]; hidden: PreviewMaterial[] };
  confirmation: { confirmed: boolean; policyRevision: number; confirmedAt: string | null };
};
type ApiEnvelope<T = unknown> = { data?: T; error?: { message?: string } | null };

const visibilityOptions: Array<{ value: Visibility; label: string; short: string }> = [
  { value: "private", label: "Private", short: "Private" },
  { value: "agent_only", label: "Agent-readable only", short: "Agent only" },
  { value: "citation_allowed", label: "Citation allowed", short: "Citation" },
  { value: "public_preview", label: "Public preview allowed", short: "Public preview" },
];

const permissionRows = [
  { label: "Agent can read", values: [false, true, true, true] },
  { label: "Visible in public answers", values: [false, false, true, true] },
  { label: "Can be cited", values: [false, false, true, true] },
  { label: "Shown in public highlights", values: [false, false, false, true] },
  { label: "Downloadable by interviewers", values: [false, false, false, false] },
];

function sourceIcon(kind: Material["kind"]) {
  if (kind === "github") return Github;
  if (kind === "notion") return BookOpen;
  if (kind === "website") return Link2;
  return FileText;
}

function feedbackFor(error: unknown, action: string) {
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? `The ${action} returned an invalid response.`
    : `The ${action} connection failed. Try again.`;
}

export function PrivacyClient({ initialOverview }: { initialOverview: PrivacyOverview }) {
  const [overview, setOverview] = useState(initialOverview);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);

  const refresh = useCallback(async () => {
    const { response, payload } = await requestApi<ApiEnvelope<PrivacyOverview>>("/api/privacy?pageSize=20", { cache: "no-store" });
    if (!response.ok) throw new Error(payload.error?.message ?? "Privacy settings could not be refreshed.");
    if (!payload.data) throw new ApiClientError("invalid_response");
    setOverview(payload.data);
    return payload.data;
  }, []);

  async function changeVisibility(material: Material, visibility: Visibility) {
    setSavingId(material.id);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<{ changed: boolean }>>(`/api/privacy/materials/${material.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      if (!response.ok) {
        setFeedback({ tone: "error", message: payload.error?.message ?? "Source visibility could not be saved." });
        return;
      }
      setOverview((current) => ({
        ...current,
        materials: { ...current.materials, items: current.materials.items.map((item) => item.id === material.id ? { ...item, visibility } : item) },
        confirmation: payload.data?.changed ? { ...current.confirmation, confirmed: false, confirmedAt: null } : current.confirmation,
      }));
      await refresh();
      setFeedback({ tone: "success", message: `${material.title} is now ${visibilityOptions.find((option) => option.value === visibility)?.label.toLowerCase()}.` });
    } catch (error) {
      setFeedback({ tone: "error", message: feedbackFor(error, "privacy update") });
    } finally {
      setSavingId(null);
    }
  }

  async function confirmPolicy() {
    setConfirming(true);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<{ confirmed: boolean }>>("/api/privacy/confirm", { method: "POST" });
      if (!response.ok) {
        setFeedback({ tone: "error", message: payload.error?.message ?? "Privacy policy could not be confirmed." });
        return;
      }
      await refresh();
      setFeedback({ tone: "success", message: "Privacy policy confirmed for the current source settings." });
    } catch (error) {
      setFeedback({ tone: "error", message: feedbackFor(error, "privacy confirmation") });
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="candidate-page privacy-page">
      <section className="page-hero compact-hero privacy-hero">
        <p className="page-kicker">Evidence Boundaries</p>
        <h1>Privacy Control <span className="title-seal" aria-hidden="true">问候</span></h1>
        <p>Control what interviewers can ask, see, and cite.</p>
      </section>

      {feedback ? <div className={`inline-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.tone === "error" ? <AlertCircle size={18} /> : feedback.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{feedback.message}<button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss"><X size={16} /></button></div> : null}

      <div className="privacy-grid">
        <section className="paper-card visibility-card">
          <div className="section-heading"><span><h2>Manage Source Visibility</h2><small>Set how each source can be used by the Agent and interviewers.</small></span><button className="icon-button" type="button" onClick={() => void refresh().catch((error) => setFeedback({ tone: "error", message: feedbackFor(error, "privacy refresh") }))} aria-label="Refresh privacy settings"><RefreshCw size={17} /></button></div>
          {overview.materials.items.length === 0 ? <div className="empty-state"><FileText size={28} /><p>No source materials yet.</p><Link className="text-link" href="/workspace/materials">Add your first source</Link></div> : (
            <div className="visibility-table" role="table" aria-label="Source visibility">
              <div className="visibility-header" role="row"><span>Source</span><span>Visibility</span></div>
              {overview.materials.items.map((material) => {
                const Icon = sourceIcon(material.kind);
                return (
                  <div className="visibility-row" role="row" key={material.id}>
                    <span className={`source-kind ${material.kind}`}><Icon size={18} /></span>
                    <span className="visibility-source"><strong>{material.title}</strong><small>{material.kind.toUpperCase()} · {material.status}</small></span>
                    <label className={`visibility-select ${material.visibility}`}>
                      <span className="sr-only">Visibility for {material.title}</span>
                      {savingId === material.id ? <LoaderCircle className="spin" size={15} /> : material.visibility === "private" ? <LockKeyhole size={15} /> : material.visibility === "public_preview" ? <Globe2 size={15} /> : material.visibility === "citation_allowed" ? <Quote size={15} /> : <Eye size={15} />}
                      <select value={material.visibility} disabled={savingId === material.id} onChange={(event) => void changeVisibility(material, event.target.value as Visibility)}>
                        {visibilityOptions.map((option) => <option value={option.value} key={option.value}>{option.label}</option>)}
                      </select><ChevronDown size={14} aria-hidden="true" />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          <Link className="add-source-link" href="/workspace/materials"><Plus size={16} /> Add Source</Link>
        </section>

        <section className="paper-card policy-card">
          <div className="section-heading"><span><h2>My Privacy Policy Rules</h2><small>These rules define how your content can be used.</small></span></div>
          <div className="policy-table" role="table" aria-label="Privacy policy capabilities">
            <div className="policy-row policy-header" role="row"><strong>Usage / Permission</strong>{visibilityOptions.map((option, index) => <span key={option.value}>{index === 0 ? <LockKeyhole size={16} /> : index === 1 ? <Eye size={16} /> : index === 2 ? <Quote size={16} /> : <Globe2 size={16} />}<small>{option.short}</small></span>)}</div>
            {permissionRows.map((row) => <div className="policy-row" role="row" key={row.label}><strong>{row.label}</strong>{row.values.map((allowed, index) => <span key={`${row.label}-${visibilityOptions[index]!.value}`} aria-label={allowed ? "Allowed" : "Not allowed"}>{allowed ? <Check size={16} /> : "—"}</span>)}</div>)}
          </div>
          <p className="policy-note"><ShieldCheck size={15} /> Uploaded files are never downloadable by interviewers.</p>
        </section>

        <section className="paper-card interviewer-preview-card">
          <div className="section-heading"><span><h2>Interviewer View Preview</h2><small>This is what interviewers can access and what stays hidden.</small></span></div>
          <div className="preview-columns">
            <PreviewList title="Accessible to Interviewers" tone="accessible" icon={Eye} items={overview.preview.accessible} empty="No sources can support public answers yet." />
            <PreviewList title="Hidden from Interviewers" tone="hidden" icon={LockKeyhole} items={overview.preview.hidden} empty="No private or Agent-only sources." />
          </div>
        </section>

        <section className={`paper-card confirm-privacy-card ${overview.confirmation.confirmed ? "confirmed" : ""}`}>
          <span className="confirm-policy-icon">{overview.confirmation.confirmed ? <ShieldCheck size={23} /> : <AlertCircle size={23} />}</span>
          <span><h2>{overview.confirmation.confirmed ? "Privacy Confirmed" : "Review Before Publishing"}</h2><p>{overview.confirmation.confirmed ? `Revision ${overview.confirmation.policyRevision} is ready for publishing checks.` : "Please review your citation boundaries carefully."}</p></span>
          <ul><li>Only Citation Allowed and Public Preview sources may support public answers.</li><li>Changing a source visibility invalidates this confirmation.</li><li>Private and Agent-only content is never shared or cited publicly.</li></ul>
          <button className="primary-button" type="button" disabled={confirming} onClick={() => void confirmPolicy()}>{confirming ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} {confirming ? "Confirming…" : overview.confirmation.confirmed ? "Confirm Again" : "Review & Confirm Privacy"}</button>
        </section>
      </div>
      <footer className="candidate-footer"><span>© 2026 Askme. All rights reserved.</span><span>Privacy · Terms · Support</span><span>English</span></footer>
    </div>
  );
}

function PreviewList({ title, tone, icon: Icon, items, empty }: { title: string; tone: string; icon: typeof Eye; items: PreviewMaterial[]; empty: string }) {
  return (
    <section className={`privacy-preview-list ${tone}`}><h3><Icon size={16} /> {title}<span>{items.length}</span></h3>{items.length === 0 ? <p>{empty}</p> : <ul>{items.map((item) => { const SourceIcon = sourceIcon(item.kind); return <li key={item.id}><SourceIcon size={15} /><span><strong>{item.title}</strong><small>{visibilityOptions.find((option) => option.value === item.visibility)?.label}</small></span></li>; })}</ul>}</section>
  );
}
