"use client";

import { ExternalLink, FileText, LoaderCircle, X } from "lucide-react";
import { type ReactNode, useEffect, useId, useMemo, useState } from "react";
import { createPortal } from "react-dom";

import { createTranslator, type Locale } from "@/i18n/core";

import { MarkdownContent } from "./markdown-content";
import { safeExternalHref, sourceOpenMode, type MaterialKind, type SourceOpenMode } from "./source-viewer-policy";
import { useModalFocus } from "./use-modal-focus";

export { sourceOpenMode, type MaterialKind, type SourceOpenMode } from "./source-viewer-policy";

type RepositorySourcePreview = {
  repository: { title: string };
  revision: { commitSha: string };
  path: string;
  lineStart: number;
  lineEnd: number;
  content: string;
};

function codeFence(content: string) {
  const longest = Math.max(0, ...[...content.matchAll(/`+/g)].map((match) => match[0].length));
  return "`".repeat(Math.max(3, longest + 1));
}

function sourceLanguage(path: string) {
  const extension = path.split(".").at(-1)?.toLowerCase() ?? "";
  return ({ ts: "typescript", tsx: "tsx", js: "javascript", jsx: "jsx", go: "go", py: "python", rs: "rust", java: "java", kt: "kotlin", rb: "ruby", php: "php", sh: "bash", sql: "sql", json: "json", yaml: "yaml", yml: "yaml", toml: "toml", md: "markdown", css: "css", html: "html", xml: "xml" } as Record<string, string>)[extension] ?? "text";
}

export function renderRepositorySourceMarkdown(source: RepositorySourcePreview, locale: Locale) {
  const fence = codeFence(source.content);
  const labels = locale === "zh-CN"
    ? { title: "来源片段", repository: "代码仓库", revision: "固定 Revision", file: "文件", lines: "行号", source: "源码" }
    : { title: "Source excerpt", repository: "Repository", revision: "Pinned revision", file: "File", lines: "Lines", source: "Source" };
  return [
    `# ${labels.title}`,
    "",
    `- **${labels.repository}：** ${source.repository.title}`,
    `- **${labels.revision}：** \`${source.revision.commitSha}\``,
    `- **${labels.file}：** \`${source.path}\``,
    `- **${labels.lines}：** ${source.lineStart}–${source.lineEnd}`,
    "",
    `## ${labels.source}`,
    "",
    `${fence}${sourceLanguage(source.path)}`,
    source.content,
    fence,
  ].join("\n");
}

function repositorySourceFromEnvelope(value: unknown): RepositorySourcePreview {
  const data = value && typeof value === "object" ? (value as { data?: unknown }).data : null;
  if (!data || typeof data !== "object") throw new Error("Repository source response is invalid");
  const source = data as Partial<RepositorySourcePreview>;
  if (
    !source.repository || typeof source.repository.title !== "string"
    || !source.revision || typeof source.revision.commitSha !== "string"
    || typeof source.path !== "string" || typeof source.lineStart !== "number"
    || typeof source.lineEnd !== "number" || typeof source.content !== "string"
  ) throw new Error("Repository source response is invalid");
  return source as RepositorySourcePreview;
}

export function SourceLink({
  title,
  href,
  mode,
  locale,
  className = "",
  icon,
}: {
  title: string;
  href: string | null;
  mode: SourceOpenMode;
  locale: Locale;
  className?: string;
  icon?: ReactNode;
}) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [open, setOpen] = useState(false);
  const [markdown, setMarkdown] = useState<string | null>(null);
  const [loadFailed, setLoadFailed] = useState(false);
  const dialogRef = useModalFocus(open, () => setOpen(false));
  const titleId = useId();

  useEffect(() => {
    if (!open || (mode !== "markdown" && mode !== "repository") || !href) return;
    const controller = new AbortController();
    void fetch(href, { cache: "no-store", signal: controller.signal })
      .then(async (response) => {
        if (!response.ok) throw new Error(`Source request failed with ${response.status}`);
        setMarkdown(mode === "repository"
          ? renderRepositorySourceMarkdown(repositorySourceFromEnvelope(await response.json()), locale)
          : await response.text());
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === "AbortError")) setLoadFailed(true);
      });
    return () => controller.abort();
  }, [href, locale, mode, open]);

  if (!href) return <strong className={`source-file-name ${className}`.trim()}>{title}</strong>;
  if (mode === "new_tab") {
    return <a className={`source-file-link ${className}`.trim()} href={href} target="_blank" rel="noreferrer noopener" aria-label={icon ? title : undefined}>{icon ?? <>{title}<ExternalLink size={13} aria-hidden="true" /></>}</a>;
  }

  return (
    <>
      <button className={`source-file-link source-file-button ${className}`.trim()} type="button" aria-label={icon ? title : undefined} onClick={() => {
        setMarkdown(null);
        setLoadFailed(false);
        setOpen(true);
      }}>{icon ?? <>{title}<FileText size={14} aria-hidden="true" /></>}</button>
      {open ? createPortal((
        <div className="source-preview-backdrop" role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}>
          <section ref={dialogRef} className={`source-preview-dialog ${mode}`} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
            <header>
              <div><FileText size={18} aria-hidden="true" /><h2 id={titleId}>{title}</h2></div>
              <button type="button" data-autofocus onClick={() => setOpen(false)} aria-label={t("shared.close")}><X size={19} /></button>
            </header>
            {mode === "markdown" || mode === "repository" ? (
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
