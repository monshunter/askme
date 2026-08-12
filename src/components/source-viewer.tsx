"use client";

import { ExternalLink, FileText, LoaderCircle, X } from "lucide-react";
import { useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { createTranslator, type Locale } from "@/i18n/core";

import { MarkdownContent } from "./markdown-content";
import { safeExternalHref, sourceOpenMode, type MaterialKind, type SourceOpenMode } from "./source-viewer-policy";
import { useModalFocus } from "./use-modal-focus";

export { sourceOpenMode, type MaterialKind, type SourceOpenMode } from "./source-viewer-policy";

export function SourceLink({
  title,
  href,
  mode,
  locale,
  className = "",
}: {
  title: string;
  href: string | null;
  mode: SourceOpenMode;
  locale: Locale;
  className?: string;
}) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const dialogRef = useModalFocus(open, () => setOpen(false));
  const titleId = useId();

  useEffect(() => {
    if (!open || mode !== "markdown" || !href) return;
    const controller = new AbortController();
    void fetch(href, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Source request failed with ${response.status}`);
        setMarkdown(await response.text());
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadFailed(true);
      });
    return () => controller.abort();
  }, [href, mode, open]);

  if (!href) return <strong className={`source-file-name ${className}`.trim()}>{title}</strong>;
  if (mode === "new_tab") {
    return <a className={`source-file-link ${className}`.trim()} href={href} target="_blank" rel="noreferrer noopener">{title}<ExternalLink size={13} aria-hidden="true" /></a>;
  }

  return (
    <>
      <button className={`source-file-link source-file-button ${className}`.trim()} type="button" onClick={() => {
        setMarkdown(null);
        setLoadFailed(false);
        setOpen(true);
      }}>{title}<FileText size={14} aria-hidden="true" /></button>
      {open ? createPortal((
        <div className="source-preview-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section ref={dialogRef} className={`source-preview-dialog ${mode}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
            <header>
              <div><FileText size={18} aria-hidden="true" /><h2 id={titleId}>{title}</h2></div>
              <button type="button" data-autofocus onClick={() => setOpen(false)} aria-label={t("shared.close")}><X size={19} /></button>
            </header>
            {mode === "markdown" ? (
              <div className="source-markdown-preview">
                {loadFailed ? <p className="source-preview-error" role="alert">{t("source.preview.loadFailed")}</p> : markdown === null ? <p className="source-preview-loading"><LoaderCircle className="spin" size={18} /> {t("shared.loading")}</p> : <MarkdownContent content={markdown} />}
              </div>
            ) : (
              <div className="source-pdf-preview"><iframe src={href} title={t("source.preview.pdfTitle", { title })} /></div>
            )}
          </section>
        </div>
      ), document.body) : null}
    </>
  );
}

export function CandidateSourceLink({
  materialId,
  title,
  kind,
  mimeType,
  externalUrl,
  locale,
  className,
}: {
  materialId: string;
  title: string;
  kind: MaterialKind;
  mimeType: string | null;
  externalUrl: string | null;
  locale: Locale;
  className?: string;
}) {
  const href = kind === "file" ? `/api/materials/${materialId}/content` : safeExternalHref(externalUrl);
  return <SourceLink title={title} href={href} mode={sourceOpenMode({ kind, title, mimeType })} locale={locale} className={className} />;
}
