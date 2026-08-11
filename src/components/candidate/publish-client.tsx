"use client";

import { AlertCircle, Check, CheckCircle2, Clipboard, Download, ExternalLink, FileText, Globe2, Link2, LoaderCircle, LockKeyhole, RefreshCw, Send, ShieldCheck, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useState } from "react";

import { ApiClientError, requestApi } from "./api-client";

type ReadinessKey = "indexed_material" | "privacy_confirmation" | "public_identity";
type Publication = {
  id: string;
  slug: string;
  status: "draft" | "published" | "revoked" | "paused";
  publishedAt: string | null;
  revokedAt: string | null;
  pausedAt: string | null;
  pauseReason: string | null;
  createdAt: string;
  updatedAt: string;
};
type PublicationOverview = {
  publication: Publication | null;
  readiness: { ready: boolean; checks: Array<{ key: ReadinessKey; label: string; detail: string; ready: boolean }> };
  publicMode: boolean;
  publicEvidence: number;
  shareUrl: string | null;
};
type ApiEnvelope<T> = { data?: T; error?: { message?: string } | null };

function connectionFeedback(error: unknown, action: string) {
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? `The ${action} returned an invalid response.`
    : `The ${action} connection failed. Try again.`;
}

function requirementHref(key: ReadinessKey) {
  if (key === "indexed_material") return "/workspace/materials";
  if (key === "privacy_confirmation") return "/workspace/privacy";
  return "/workspace";
}

export function PublishClient({ initialOverview }: { initialOverview: PublicationOverview }) {
  const [overview, setOverview] = useState(initialOverview);
  const [action, setAction] = useState<"generate" | "publish" | "revoke" | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);

  async function refresh() {
    const { response, payload } = await requestApi<ApiEnvelope<PublicationOverview>>("/api/publications/current", { cache: "no-store" });
    if (!response.ok) throw new Error(payload.error?.message ?? "Publishing status could not be refreshed.");
    if (!payload.data) throw new ApiClientError("invalid_response");
    setOverview(payload.data);
    return payload.data;
  }

  async function mutate(kind: "generate" | "publish" | "revoke", path: string) {
    setAction(kind);
    setNotice(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<{ changed: boolean; publication: Publication; shareUrl?: string }>>(path, { method: "POST" });
      if (!response.ok) {
        setNotice({ tone: "error", message: payload.error?.message ?? `The ${kind} action could not be completed.` });
        await refresh().catch(() => undefined);
        return;
      }
      const current = await refresh();
      if (kind === "generate") setNotice({ tone: "success", message: payload.data?.changed ? "A private draft share link was generated." : "The existing share link is ready." });
      if (kind === "publish") setNotice({ tone: "success", message: payload.data?.changed ? "Your Agent is now available to interviewers." : "Your Agent was already published." });
      if (kind === "revoke") setNotice({ tone: "success", message: "Public access was revoked. The old link no longer works." });
      if (kind === "revoke" || !current.publication) setConfirmRevoke(false);
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, kind) });
    } finally {
      setAction(null);
    }
  }

  async function copyLink() {
    if (!overview.shareUrl) return;
    try {
      await navigator.clipboard.writeText(overview.shareUrl);
      setNotice({ tone: "success", message: "Share link copied to the clipboard." });
    } catch {
      setNotice({ tone: "error", message: "The browser blocked clipboard access. Select and copy the link manually." });
    }
  }

  function downloadLink() {
    if (!overview.shareUrl) return;
    const contents = [`Askme Candidate Agent`, `Status: ${overview.publication?.status ?? "draft"}`, `Link: ${overview.shareUrl}`, `Generated: ${new Date().toISOString()}`].join("\n");
    const href = URL.createObjectURL(new Blob([contents], { type: "text/plain;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = "askme-agent-link.txt";
    anchor.click();
    URL.revokeObjectURL(href);
    setNotice({ tone: "success", message: "Agent link information downloaded." });
  }

  const published = overview.publication?.status === "published";
  return (
    <div className="candidate-page publish-page">
      <section className="page-hero compact-hero publish-hero"><p className="page-kicker">Controlled Sharing</p><h1>Publish Agent <span className="title-seal" aria-hidden="true">问候</span></h1><p>Review readiness, create an opaque link, and control interviewer access.</p></section>
      {notice ? <div className={`inline-feedback ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.tone === "error" ? <AlertCircle size={18} /> : notice.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{notice.message}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div> : null}

      <div className="publish-layout">
        <section className="paper-card readiness-card">
          <header><span className={overview.readiness.ready ? "ready" : "blocked"}>{overview.readiness.ready ? <ShieldCheck size={24} /> : <AlertCircle size={24} />}</span><span><h2>{overview.readiness.ready ? "Ready to publish" : "Complete publishing requirements"}</h2><p>Every blocking check is calculated from current database state.</p></span><button className="icon-button" type="button" onClick={() => void refresh().catch((error) => setNotice({ tone: "error", message: connectionFeedback(error, "status refresh") }))} aria-label="Refresh publishing readiness"><RefreshCw size={17} /></button></header>
          <div className="readiness-list">{overview.readiness.checks.map((check) => <article className={check.ready ? "ready" : "blocked"} key={check.key}>{check.ready ? <CheckCircle2 size={20} /> : <XCircle size={20} />}<span><strong>{check.label}</strong><small>{check.detail}</small></span>{!check.ready ? <Link href={requirementHref(check.key)}>Resolve</Link> : null}</article>)}</div>
          <p className={`public-evidence-note ${overview.publicEvidence > 0 ? "ready" : "warning"}`}><FileText size={16} /> {overview.publicEvidence > 0 ? `${overview.publicEvidence} source${overview.publicEvidence === 1 ? "" : "s"} can support public answers.` : "No Citation Allowed or Public Preview sources exist yet; publishing is allowed, but answers will report insufficient evidence."}</p>
        </section>

        <section className="paper-card publication-status-card">
          <div className={`publication-orb ${published ? "published" : overview.publication ? "draft" : "none"}`}>{published ? <Globe2 size={31} /> : <LockKeyhole size={30} />}</div>
          <span className={`publication-status ${published ? "published" : overview.publication ? "draft" : "none"}`}>{published ? "Published" : overview.publication ? "Draft link" : "Not published"}</span>
          <h2>{published ? "Your Agent is public" : overview.publication ? "Your link is private until publishing" : "Create a secure share link"}</h2>
          <p>{published ? overview.publicMode ? "Anonymous interviewers can open the link and ask grounded questions." : "Public Mode is off, so anonymous access is unavailable." : "The link uses a random, non-identifying slug and reveals nothing until publication."}</p>
          {overview.publication?.publishedAt ? <small>Published {new Date(overview.publication.publishedAt).toLocaleString()}</small> : null}
        </section>

        <section className="paper-card share-link-card">
          <div className="section-heading"><span><h2>Candidate Agent Link</h2><small>Generate once, preview with public permissions, then publish when ready.</small></span></div>
          {overview.shareUrl ? <div className="share-link-box"><Link2 size={18} /><label><span className="sr-only">Candidate Agent share link</span><input readOnly value={overview.shareUrl} onFocus={(event) => event.currentTarget.select()} /></label><button type="button" onClick={() => void copyLink()}><Clipboard size={17} /> Copy</button></div> : <div className="empty-link"><Link2 size={24} /><p>No share link has been generated.</p></div>}
          <div className="share-actions">
            <button className="secondary-button" type="button" disabled={Boolean(action)} onClick={() => void mutate("generate", "/api/publications/link")}>{action === "generate" ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />} {overview.shareUrl ? "Keep Current Link" : "Generate Share Link"}</button>
            {overview.shareUrl ? <button className="secondary-button" type="button" onClick={downloadLink}><Download size={17} /> Download Link</button> : null}
            {overview.publication ? <Link className="secondary-button" href="/workspace/publish/preview"><ExternalLink size={17} /> Public Preview</Link> : null}
            {published && overview.shareUrl ? <a className="secondary-button" href={overview.shareUrl} target="_blank" rel="noreferrer"><Globe2 size={17} /> Open Public Page</a> : null}
          </div>
        </section>

        <section className="paper-card publish-action-card">
          <span className="publish-action-icon"><Send size={23} /></span><span><h2>{published ? "Manage public access" : "Publish your Agent"}</h2><p>{published ? "Republishing is idempotent. Revoke to make the current link unavailable immediately." : "Publishing also enables Public Mode for interviewer answers."}</p></span>
          {!published ? <button className="primary-button" type="button" disabled={Boolean(action) || !overview.readiness.ready} onClick={() => void mutate("publish", "/api/publications/publish")}>{action === "publish" ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} Publish Agent</button> : <div className="published-actions">{!overview.publicMode ? <button className="primary-button" type="button" disabled={Boolean(action)} onClick={() => void mutate("publish", "/api/publications/publish")}>{action === "publish" ? <LoaderCircle className="spin" size={17} /> : <Globe2 size={17} />} Enable Public Access</button> : null}<button className="danger-button" type="button" disabled={Boolean(action)} onClick={() => setConfirmRevoke(true)}><LockKeyhole size={17} /> Revoke Access</button></div>}
        </section>
      </div>

      {confirmRevoke ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmRevoke(false); }}><section className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="revoke-title" aria-describedby="revoke-description"><span className="confirm-icon"><AlertCircle size={26} /></span><h2 id="revoke-title">Revoke public Agent access?</h2><p id="revoke-description">The current link will stop working immediately. A later republish creates a new opaque link.</p><div><button className="secondary-button" type="button" autoFocus onClick={() => setConfirmRevoke(false)}>Keep Published</button><button className="danger-button" type="button" disabled={action === "revoke"} onClick={() => void mutate("revoke", "/api/publications/revoke")}>{action === "revoke" ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />} Revoke Link</button></div></section></div> : null}
      <footer className="candidate-footer"><span>© 2026 Askme. All rights reserved.</span><span>Privacy · Terms · Support</span><span>English</span></footer>
    </div>
  );
}
