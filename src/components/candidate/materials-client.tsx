"use client";

import { AlertCircle, ArrowRight, BookOpen, Check, FileArchive, FileCode2, FileText, Github, Link2, LoaderCircle, NotebookTabs, RefreshCw, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";

import { ApiClientError, requestApi } from "./api-client";
import { formatUploadFeedback } from "./material-upload-feedback";

type Material = {
  id: string;
  title: string;
  originalName: string | null;
  kind: "file" | "github" | "notion" | "website";
  mimeType: string | null;
  sizeBytes: number | null;
  externalUrl: string | null;
  status: "queued" | "processing" | "indexed" | "failed";
  visibility: string;
  errorCode: string | null;
  errorMessage: string | null;
  createdAt: string;
  updatedAt: string;
};

type MaterialPage = { items: Material[]; page: number; pageSize: number; total: number; totalPages: number };
type Provider = "github" | "notion" | "website";
type ApiEnvelope<T = unknown> = { data?: T; error?: { message?: string } | null };

function formatBytes(bytes: number | null) {
  if (bytes === null) return "Remote snapshot";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string) {
  return new Intl.DateTimeFormat("en", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
}

function statusLabel(status: Material["status"]) {
  return status[0]!.toUpperCase() + status.slice(1);
}

function requestFailureMessage(error: unknown, action: string) {
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? `The ${action} returned an invalid response.`
    : `The ${action} connection failed. Try again.`;
}

export function MaterialsClient({ initialMaterials }: { initialMaterials: MaterialPage }) {
  const [materials, setMaterials] = useState(initialMaterials);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);

  const refresh = useCallback(async () => {
    try {
      const { response, payload } = await requestApi<ApiEnvelope<MaterialPage>>("/api/materials?pageSize=20", { cache: "no-store" });
      if (!response.ok) {
        setFeedback({ tone: "error", message: payload.error?.message ?? "Materials could not be refreshed." });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setMaterials(payload.data);
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, "materials list") });
    }
  }, []);

  useEffect(() => {
    if (!materials.items.some((material) => material.status === "queued" || material.status === "processing")) return;
    const timer = window.setInterval(() => void refresh(), 2_000);
    return () => window.clearInterval(timer);
  }, [materials.items, refresh]);

  const uploadFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return;
      setFeedback(null);
      setUploadProgress(0);
      const form = new FormData();
      files.forEach((file) => form.append("files", file));
      const request = new XMLHttpRequest();
      request.open("POST", "/api/materials/upload");
      request.upload.addEventListener("progress", (event) => {
        if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      });
      request.addEventListener("load", () => {
        setUploadProgress(null);
        let payload: { data?: { failures?: number; items?: Array<{ ok: boolean; name?: string; error?: { message?: string } }> }; error?: { message?: string } } = {};
        try {
          payload = JSON.parse(request.responseText);
        } catch {
          setFeedback({ tone: "error", message: "The upload returned an invalid response." });
          return;
        }
        if (request.status === 201 || request.status === 207) {
          const failures = payload.data?.failures ?? 0;
          setFeedback({ tone: failures > 0 ? "error" : "success", message: formatUploadFeedback(files.length, payload.data ?? {}) });
          void refresh();
        } else {
          setFeedback({ tone: "error", message: payload.error?.message ?? "The files could not be uploaded." });
        }
      });
      request.addEventListener("error", () => {
        setUploadProgress(null);
        setFeedback({ tone: "error", message: "The upload connection failed. Try again." });
      });
      request.send(form);
    },
    [refresh],
  );

  async function connectSource(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!provider) return;
    const activeProvider = provider;
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    setConnecting(true);
    setFeedback(null);
    const body: Record<string, string> = { kind: activeProvider, url: String(form.get("url") ?? "") };
    const token = String(form.get("token") ?? "").trim();
    if (token) body.token = token;
    if (activeProvider === "notion") body.targetType = String(form.get("targetType") ?? "page");
    try {
      const { response, payload } = await requestApi<ApiEnvelope>("/api/materials/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setFeedback({ tone: "error", message: payload.error?.message ?? "The external source could not be connected." });
        return;
      }
      formElement.reset();
      setProvider(null);
      setFeedback({ tone: "success", message: `${activeProvider === "website" ? "Website" : activeProvider === "github" ? "GitHub" : "Notion"} snapshot queued for indexing.` });
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, "external source") });
    } finally {
      setConnecting(false);
    }
  }

  async function retry(material: Material) {
    try {
      const { response, payload } = await requestApi<ApiEnvelope>(`/api/materials/${material.id}/retry`, { method: "POST" });
      setFeedback(response.ok ? { tone: "success", message: `${material.title} was queued again.` } : { tone: "error", message: payload.error?.message ?? "Retry failed." });
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, "retry") });
    }
  }

  async function remove(material: Material) {
    setDeleting(true);
    try {
      const { response, payload } = await requestApi<ApiEnvelope>(`/api/materials/${material.id}`, { method: "DELETE" });
      setFeedback(response.ok ? { tone: "success", message: `${material.title} was deleted.` } : { tone: "error", message: payload.error?.message ?? "Delete failed." });
      if (response.ok) setPendingDelete(null);
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, "delete") });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="candidate-page materials-page">
      <section className="page-hero compact-hero">
        <p className="page-kicker">Source Materials</p>
        <h1>Upload Materials <span className="title-seal" aria-hidden="true">问候</span></h1>
        <p>Provide source materials to build your career knowledge base.<br />Your Agent will learn from these and answer with evidence.</p>
      </section>

      {feedback ? <div className={`inline-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.tone === "error" ? <AlertCircle size={18} /> : feedback.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{feedback.message}<button type="button" onClick={() => setFeedback(null)} aria-label="Dismiss"><X size={16} /></button></div> : null}

      <div className="materials-layout">
        <div className="materials-primary">
          <section
            className="upload-dropzone"
            onDragOver={(event) => event.preventDefault()}
            onDrop={(event) => {
              event.preventDefault();
              uploadFiles(Array.from(event.dataTransfer.files));
            }}
          >
            <span className="dropzone-icon"><UploadCloud size={38} /></span>
            <h2>Drag and drop files here, or <button type="button" onClick={() => fileInput.current?.click()}>click to browse</button></h2>
            <p>PDF, DOCX, PPTX, XLSX, TXT, MD · Up to 50 MiB per file · 10 files at a time</p>
            <input
              className="sr-only"
              ref={fileInput}
              type="file"
              multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.currentTarget.value = "";
                uploadFiles(files);
              }}
            />
            <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}><FileArchive size={18} /> Select Files</button>
            {uploadProgress !== null ? <div className="upload-transfer" role="status"><span><LoaderCircle className="spin" size={16} /> Transferring files</span><strong>{uploadProgress}%</strong><div><i style={{ width: `${uploadProgress}%` }} /></div></div> : null}
          </section>

          <section className="supported-types" aria-labelledby="supported-title">
            <h2 id="supported-title">Supported source types</h2>
            <div className="source-type-grid">
              {[
                ["Resume", "PDF, DOCX", FileText],
                ["Project Documents", "PDF, DOCX, PPTX", FileArchive],
                ["GitHub Repository", "Public or private", Github],
                ["Technical Articles", "PDF, URL", NotebookTabs],
                ["Architecture Docs", "PDF, DOCX", BookOpen],
                ["Open Source", "Repositories", FileCode2],
                ["Personal Notes", "MD, TXT", FileText],
              ].map(([title, copy, Icon]) => (
                <article key={String(title)}><Icon size={27} /><strong>{String(title)}</strong><small>{String(copy)}</small></article>
              ))}
            </div>
          </section>

          <section className="paper-card connect-sources">
            <h2>Connect external sources</h2>
            <p>Credentials are used for this request only and are never stored.</p>
            <div className="connector-grid">
              {[
                { id: "github" as const, title: "GitHub", copy: "Import a repository and README.", icon: Github, action: "Connect GitHub" },
                { id: "notion" as const, title: "Notion", copy: "Snapshot a shared page or database.", icon: NotebookTabs, action: "Connect Notion" },
                { id: "website" as const, title: "Blog or Website", copy: "Import public HTML or plain text.", icon: Link2, action: "Add URL" },
              ].map(({ id, title, copy, icon: Icon, action }) => (
                <article className={provider === id ? "selected" : ""} key={id}>
                  <Icon size={28} /><span><strong>{title}</strong><small>{copy}</small></span>
                  <button type="button" onClick={() => setProvider(provider === id ? null : id)}>{provider === id ? "Close" : action}</button>
                </article>
              ))}
            </div>
            {provider ? (
              <form className="connector-form" onSubmit={connectSource}>
                <div><label htmlFor="source-url">{provider === "github" ? "Repository URL" : provider === "notion" ? "Notion URL" : "Website URL"}</label><input id="source-url" name="url" type="url" required placeholder={provider === "github" ? "https://github.com/owner/repository" : provider === "notion" ? "https://www.notion.so/..." : "https://example.com/article"} /></div>
                {provider !== "website" ? <div><label htmlFor="source-token">Access token {provider === "github" ? "(optional for public repositories)" : "(required)"}</label><input id="source-token" name="token" type="password" required={provider === "notion"} autoComplete="off" /></div> : null}
                {provider === "notion" ? <div><label htmlFor="target-type">Notion target</label><select id="target-type" name="targetType"><option value="page">Page</option><option value="database">Database</option></select></div> : null}
                <button className="primary-button" disabled={connecting} type="submit">{connecting ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />} {connecting ? "Connecting…" : "Create snapshot"}</button>
              </form>
            ) : null}
            <div className="privacy-note"><ShieldCheckIcon /><span><strong>Private by default.</strong> Imported content is only used within the permissions you configure.</span></div>
          </section>
        </div>

        <aside className="materials-secondary">
          <section className="paper-card progress-card">
            <div className="section-heading"><h2>Processing Status</h2><button className="icon-button" type="button" onClick={() => void refresh()} aria-label="Refresh materials"><RefreshCw size={17} /></button></div>
            {materials.items.length === 0 ? <div className="empty-state"><UploadCloud size={27} /><p>No uploads yet.</p></div> : (
              <ul className="progress-list">
                {materials.items.slice(0, 5).map((material) => (
                  <li key={material.id}>
                    <span className="file-tile"><FileText size={17} /></span>
                    <span className="list-main"><strong>{material.title}</strong><small>{formatBytes(material.sizeBytes)}</small><span className={`progress-line ${material.status}`}><i /></span>{material.errorMessage ? <em>{material.errorMessage}</em> : null}</span>
                    <span className={`status-symbol ${material.status}`}>{material.status === "indexed" ? <Check size={17} /> : material.status === "failed" ? <AlertCircle size={17} /> : <LoaderCircle className={material.status === "processing" ? "spin" : ""} size={17} />}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="paper-card recently-uploaded">
            <div className="section-heading"><h2>Recently Uploaded</h2><span>{materials.total} total</span></div>
            {materials.items.length === 0 ? <div className="empty-state"><FileText size={27} /><p>Your recent materials appear here.</p></div> : (
              <ul className="material-list">
                {materials.items.map((material) => (
                  <li key={material.id}>
                    <span className="file-tile"><FileText size={17} /></span>
                    <span className="list-main"><strong>{material.title}</strong><small>{formatDate(material.createdAt)} · {formatBytes(material.sizeBytes)}</small>{material.errorMessage ? <em>{material.errorMessage}</em> : null}</span>
                    <span className={`status-pill ${material.status}`}>{statusLabel(material.status)}</span>
                    <span className="row-actions">
                      {material.status === "failed" ? <button type="button" onClick={() => void retry(material)} aria-label={`Retry ${material.title}`} title="Retry"><RotateCcw size={16} /></button> : null}
                      <button type="button" onClick={() => setPendingDelete(material)} aria-label={`Delete ${material.title}`} title="Delete"><Trash2 size={16} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="go-to-link" href="/workspace/knowledge">Go to Knowledge Base <ArrowRight size={16} /></Link>
          </section>
        </aside>
      </div>
      {pendingDelete ? (
        <div className="confirm-backdrop" role="presentation">
          <section className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-material-title" aria-describedby="delete-material-copy">
            <span className="confirm-icon"><Trash2 size={22} /></span>
            <h2 id="delete-material-title">Delete source material?</h2>
            <p id="delete-material-copy">Delete <strong>{pendingDelete.title}</strong>, its stored snapshot, and knowledge derived only from it. Other source materials stay unchanged.</p>
            <div>
              <button className="secondary-button" type="button" autoFocus disabled={deleting} onClick={() => setPendingDelete(null)}>Cancel</button>
              <button className="danger-button" type="button" disabled={deleting} onClick={() => void remove(pendingDelete)}>{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />} {deleting ? "Deleting…" : "Delete material"}</button>
            </div>
          </section>
        </div>
      ) : null}
      <footer className="candidate-footer"><span>© 2026 Askme. All rights reserved.</span><span>Privacy · Terms · Support</span><span>English</span></footer>
    </div>
  );
}

function ShieldCheckIcon() {
  return <span className="round-icon"><Check size={18} /></span>;
}
