"use client";

import { AlertCircle, ArrowRight, BookOpen, Check, FileArchive, FileCode2, FileText, Github, Link2, LoaderCircle, NotebookTabs, RefreshCw, RotateCcw, Trash2, UploadCloud, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { LanguageSwitcher } from "@/components/language-switcher";
import { useModalFocus } from "@/components/use-modal-focus";
import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

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

function formatBytes(bytes: number | null, locale: Locale) {
  if (bytes === null) return createTranslator(locale)("materials.remoteSnapshot");
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
}

function formatDate(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
}

const materialStatusKeys: Record<Material["status"], TranslationKey> = {
  queued: "status.queued", processing: "status.processing", indexed: "status.indexed", failed: "status.failed",
};

function statusLabel(status: Material["status"], locale: Locale) {
  return createTranslator(locale)(materialStatusKeys[status]);
}

function requestFailureMessage(error: unknown, action: string, locale: Locale) {
  const t = createTranslator(locale);
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? t("materials.connectionInvalid", { action })
    : t("materials.connectionFailed", { action });
}

export function MaterialsClient({ initialMaterials, locale }: { initialMaterials: MaterialPage; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [materials, setMaterials] = useState(initialMaterials);
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const [provider, setProvider] = useState<Provider | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [pendingDelete, setPendingDelete] = useState<Material | null>(null);
  const [deleting, setDeleting] = useState(false);
  const fileInput = useRef<HTMLInputElement>(null);
  const deleteDialogRef = useModalFocus(Boolean(pendingDelete), () => setPendingDelete(null), deleting);

  const refresh = useCallback(async () => {
    try {
      const { response, payload } = await requestApi<ApiEnvelope<MaterialPage>>("/api/materials?pageSize=20", { cache: "no-store" });
      if (!response.ok) {
        setFeedback({ tone: "error", message: t("materials.refreshFailed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setMaterials(payload.data);
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, t("materials.action.list"), locale) });
    }
  }, [locale, t]);

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
          setFeedback({ tone: "error", message: t("materials.uploadInvalid") });
          return;
        }
        if (request.status === 201 || request.status === 207) {
          const failures = payload.data?.failures ?? 0;
          setFeedback({ tone: failures > 0 ? "error" : "success", message: formatUploadFeedback(files.length, payload.data ?? {}, locale) });
          void refresh();
        } else {
          setFeedback({ tone: "error", message: t("materials.uploadFailed") });
        }
      });
      request.addEventListener("error", () => {
        setUploadProgress(null);
        setFeedback({ tone: "error", message: t("materials.uploadConnection") });
      });
      request.send(form);
    },
    [locale, refresh, t],
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
      const { response } = await requestApi<ApiEnvelope>("/api/materials/connect", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) {
        setFeedback({ tone: "error", message: t("materials.connectFailed") });
        return;
      }
      formElement.reset();
      setProvider(null);
      setFeedback({ tone: "success", message: t("materials.snapshotQueued", { provider: activeProvider === "website" ? t("materials.connect.website.title") : activeProvider === "github" ? "GitHub" : "Notion" }) });
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, t("materials.action.external"), locale) });
    } finally {
      setConnecting(false);
    }
  }

  async function retry(material: Material) {
    try {
      const { response } = await requestApi<ApiEnvelope>(`/api/materials/${material.id}/retry`, { method: "POST" });
      setFeedback(response.ok ? { tone: "success", message: t("materials.retryQueued", { title: material.title }) } : { tone: "error", message: t("materials.retryFailed") });
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, t("materials.action.retry"), locale) });
    }
  }

  async function remove(material: Material) {
    setDeleting(true);
    try {
      const { response } = await requestApi<ApiEnvelope>(`/api/materials/${material.id}`, { method: "DELETE" });
      setFeedback(response.ok ? { tone: "success", message: t("materials.deleted", { title: material.title }) } : { tone: "error", message: t("materials.deleteFailed") });
      if (response.ok) setPendingDelete(null);
      await refresh();
    } catch (error) {
      setFeedback({ tone: "error", message: requestFailureMessage(error, t("materials.action.delete"), locale) });
    } finally {
      setDeleting(false);
    }
  }

  return (
    <div className="candidate-page materials-page">
      <section className="page-hero compact-hero">
        <p className="page-kicker">{t("materials.kicker")}</p>
        <h1>{t("materials.title")} <span className="title-seal" aria-hidden="true">问候</span></h1>
        <p>{t("materials.copy1")}<br />{t("materials.copy2")}</p>
      </section>

      {feedback ? <div className={`inline-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.tone === "error" ? <AlertCircle size={18} /> : feedback.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{feedback.message}<button type="button" onClick={() => setFeedback(null)} aria-label={t("shared.dismiss")}><X size={16} /></button></div> : null}

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
            <h2>{t("materials.drop.prefix")} <button type="button" onClick={() => fileInput.current?.click()}>{t("materials.drop.browse")}</button></h2>
            <p>{t("materials.drop.rules")}</p>
            <input
              className="sr-only"
              ref={fileInput}
              type="file"
              aria-label={t("materials.select")}
              multiple
              accept=".pdf,.docx,.pptx,.xlsx,.txt,.md,application/pdf,text/plain,text/markdown"
              onChange={(event) => {
                const files = Array.from(event.target.files ?? []);
                event.currentTarget.value = "";
                uploadFiles(files);
              }}
            />
            <button className="secondary-button" type="button" onClick={() => fileInput.current?.click()}><FileArchive size={18} /> {t("materials.select")}</button>
            {uploadProgress !== null ? <div className="upload-transfer" role="status"><span><LoaderCircle className="spin" size={16} /> {t("materials.transferring")}</span><strong>{uploadProgress}%</strong><div><i style={{ width: `${uploadProgress}%` }} /></div></div> : null}
          </section>

          <section className="supported-types" aria-labelledby="supported-title">
            <h2 id="supported-title">{t("materials.supported")}</h2>
            <div className="source-type-grid">
              {[
                [t("materials.type.resume"), "PDF, DOCX", FileText],
                [t("materials.type.project"), "PDF, DOCX, PPTX", FileArchive],
                [t("materials.type.github"), t("materials.type.publicPrivate"), Github],
                [t("materials.type.articles"), "PDF, URL", NotebookTabs],
                [t("materials.type.architecture"), "PDF, DOCX", BookOpen],
                [t("materials.type.openSource"), t("materials.type.repositories"), FileCode2],
                [t("materials.type.notes"), "MD, TXT", FileText],
              ].map(([title, copy, Icon]) => (
                <article key={String(title)}><Icon size={27} /><strong>{String(title)}</strong><small>{String(copy)}</small></article>
              ))}
            </div>
          </section>

          <section className="paper-card connect-sources">
            <h2>{t("materials.connect.title")}</h2>
            <p>{t("materials.connect.copy")}</p>
            <div className="connector-grid">
              {[
                { id: "github" as const, title: "GitHub", copy: t("materials.connect.github.copy"), icon: Github, action: t("materials.connect.github.action") },
                { id: "notion" as const, title: "Notion", copy: t("materials.connect.notion.copy"), icon: NotebookTabs, action: t("materials.connect.notion.action") },
                { id: "website" as const, title: t("materials.connect.website.title"), copy: t("materials.connect.website.copy"), icon: Link2, action: t("materials.connect.website.action") },
              ].map(({ id, title, copy, icon: Icon, action }) => (
                <article className={provider === id ? "selected" : ""} key={id}>
                  <Icon size={28} /><span><strong>{title}</strong><small>{copy}</small></span>
                  <button type="button" onClick={() => setProvider(provider === id ? null : id)}>{provider === id ? t("shared.close") : action}</button>
                </article>
              ))}
            </div>
            {provider ? (
              <form className="connector-form" onSubmit={connectSource}>
                <div><label htmlFor="source-url">{provider === "github" ? t("materials.connect.repositoryUrl") : provider === "notion" ? t("materials.connect.notionUrl") : t("materials.connect.websiteUrl")}</label><input id="source-url" name="url" type="url" required placeholder={provider === "github" ? "https://github.com/owner/repository" : provider === "notion" ? "https://www.notion.so/..." : "https://example.com/article"} /></div>
                {provider !== "website" ? <div><label htmlFor="source-token">{provider === "github" ? t("materials.connect.tokenOptional") : t("materials.connect.tokenRequired")}</label><input id="source-token" name="token" type="password" required={provider === "notion"} autoComplete="off" /></div> : null}
                {provider === "notion" ? <div><label htmlFor="target-type">{t("materials.connect.notionTarget")}</label><select id="target-type" name="targetType"><option value="page">{t("materials.connect.page")}</option><option value="database">{t("materials.connect.database")}</option></select></div> : null}
                <button className="primary-button" disabled={connecting} type="submit">{connecting ? <LoaderCircle className="spin" size={17} /> : <Link2 size={17} />} {connecting ? t("materials.connect.connecting") : t("materials.connect.create")}</button>
              </form>
            ) : null}
            <div className="privacy-note"><ShieldCheckIcon /><span><strong>{t("materials.private.title")}</strong> {t("materials.private.copy")}</span></div>
          </section>
        </div>

        <aside className="materials-secondary">
          <section className="paper-card progress-card">
            <div className="section-heading"><h2>{t("materials.processing.title")}</h2><button className="icon-button" type="button" onClick={() => void refresh()} aria-label={t("materials.processing.refresh")}><RefreshCw size={17} /></button></div>
            {materials.items.length === 0 ? <div className="empty-state"><UploadCloud size={27} /><p>{t("materials.processing.empty")}</p></div> : (
              <ul className="progress-list">
                {materials.items.slice(0, 5).map((material) => (
                  <li key={material.id}>
                    <span className="file-tile"><FileText size={17} /></span>
                    <span className="list-main"><strong>{material.title}</strong><small>{formatBytes(material.sizeBytes, locale)}</small><span className={`progress-line ${material.status}`}><i /></span>{material.errorMessage ? <em>{locale === "en" ? material.errorMessage : t("materials.error.processing")}</em> : null}</span>
                    <span className={`status-symbol ${material.status}`}>{material.status === "indexed" ? <Check size={17} /> : material.status === "failed" ? <AlertCircle size={17} /> : <LoaderCircle className={material.status === "processing" ? "spin" : ""} size={17} />}</span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="paper-card recently-uploaded">
            <div className="section-heading"><h2>{t("materials.recent.title")}</h2><span>{t("materials.recent.total", { count: materials.total })}</span></div>
            {materials.items.length === 0 ? <div className="empty-state"><FileText size={27} /><p>{t("materials.recent.empty")}</p></div> : (
              <ul className="material-list">
                {materials.items.map((material) => (
                  <li key={material.id}>
                    <span className="file-tile"><FileText size={17} /></span>
                    <span className="list-main"><strong>{material.title}</strong><small>{formatDate(material.createdAt, locale)} · {formatBytes(material.sizeBytes, locale)}</small>{material.errorMessage ? <em>{locale === "en" ? material.errorMessage : t("materials.error.processing")}</em> : null}</span>
                    <span className={`status-pill ${material.status}`}>{statusLabel(material.status, locale)}</span>
                    <span className="row-actions">
                      {material.status === "failed" ? <button type="button" onClick={() => void retry(material)} aria-label={t("materials.retry", { title: material.title })} title={t("materials.action.retry")}><RotateCcw size={16} /></button> : null}
                      <button type="button" onClick={() => setPendingDelete(material)} aria-label={t("materials.delete", { title: material.title })} title={t("materials.action.delete")}><Trash2 size={16} /></button>
                    </span>
                  </li>
                ))}
              </ul>
            )}
            <Link className="go-to-link" href="/workspace/knowledge">{t("materials.goKnowledge")} <ArrowRight size={16} /></Link>
          </section>
        </aside>
      </div>
      {pendingDelete ? (
        <div className="confirm-backdrop" role="presentation">
          <section ref={deleteDialogRef} className="confirm-dialog" role="dialog" aria-modal="true" aria-labelledby="delete-material-title" aria-describedby="delete-material-copy" tabIndex={-1}>
            <span className="confirm-icon"><Trash2 size={22} /></span>
            <h2 id="delete-material-title">{t("materials.confirm.title")}</h2>
            <p id="delete-material-copy">{t("materials.confirm.copyBefore")} <strong>{pendingDelete.title}</strong>{locale === "zh-CN" ? "，" : ", "}{t("materials.confirm.copyAfter")}</p>
            <div>
              <button className="secondary-button" type="button" data-autofocus disabled={deleting} onClick={() => setPendingDelete(null)}>{t("shared.cancel")}</button>
              <button className="danger-button" type="button" disabled={deleting} onClick={() => void remove(pendingDelete)}>{deleting ? <LoaderCircle className="spin" size={16} /> : <Trash2 size={16} />} {deleting ? t("materials.confirm.deleting") : t("materials.confirm.submit")}</button>
            </div>
          </section>
        </div>
      ) : null}
      <footer className="candidate-footer"><span>{t("shared.footerRights")}</span><span>{t("shared.footerLinks")}</span><LanguageSwitcher locale={locale} compact /></footer>
    </div>
  );
}

function ShieldCheckIcon() {
  return <span className="round-icon"><Check size={18} /></span>;
}
