"use client";

import { AlertCircle, Check, FileSearch, FileText, Github, LoaderCircle, Pencil, Plus, RefreshCw, ShieldCheck, X } from "lucide-react";
import { FormEvent, useCallback, useState } from "react";

import type { Locale } from "@/i18n/core";
import { MarkdownContent } from "@/components/markdown-content";
import { useModalFocus } from "@/components/use-modal-focus";

import { ApiClientError, requestApi } from "./api-client";

type Visibility = "private" | "agent_only" | "citation_allowed" | "public_preview";
type Repository = {
  id: string;
  canonicalUrl: string;
  displayName: string;
  visibility: Visibility;
  publicDeepAnalysisEnabled: boolean;
  latestRevision: null | { id: string; requestedRef: string; commitSha: string; state: "staging" | "stored" | "failed" | "collected"; errorCode: string | null; fileCount: number; extractedBytes: number; createdAt: string };
  activeRevision: null | { id: string; commitSha: string };
  activeProjectionId: string | null;
  ragIndexState: "not_indexed" | "indexing" | "ready" | "ready_with_warnings" | "failed" | "stale";
  ragIndexCommitSha: string | null;
  ragIndexedFileCount: number;
  ragSkippedFileCount: number;
  ragIndexWarnings: string[];
  ragIndexErrorCode: string | null;
  latestAnalysisRun: null | { id: string; state: "pending" | "running" | "completed" | "failed" | "cancelled"; phase: string; analysisGeneration: number; safeErrorCode: string | null; createdAt: string; finishedAt: string | null };
  createdAt: string;
  updatedAt: string;
};
type Envelope<T> = { data: T | null; error: { code: string; message: string } | null };
type WikiPage = {
  id: string;
  path: string;
  title: string;
  generatedMarkdown: string;
  sortOrder: number;
  editedMarkdown: string | null;
  citations: Array<{ marker: string; path: string; lineStart: number; lineEnd: number; contentHash: string; rank: number }>;
};
type DossierReview = {
  repository: { id: string; displayName: string; visibility: Visibility; activeRevisionId: string | null; activeProjectionId: string | null };
  dossier: null | {
    id: string;
    revisionId: string;
    commitSha: string;
    generatedVersion: number;
    state: string;
    title: string;
    summary: string;
    coverage: { analysisMode?: string; eligibleFileCount?: number; examinedFileCount?: number; examinedPaths?: string[]; coveredAreas?: string[]; skipped?: Array<{ reason: string; count: number }> };
    configuredModel: string;
    actualModel: string | null;
    outdatedReason: string | null;
    projectionId: string | null;
    projectionState: string | null;
    isActive: boolean;
    pages: WikiPage[];
  };
};

const copy = {
  en: {
    kicker: "Repository knowledge", title: "Code Repositories", intro: "Pin one immutable GitHub revision, review its generated Wiki, and approve it as Agent knowledge.",
    connect: "Add a Repository", connectCopy: "Pin a GitHub branch, tag, or full commit SHA. Private repositories need a one-time Token.", directory: "Added Repositories", close: "Close add Repository dialog", cancel: "Cancel", url: "GitHub Repository URL", ref: "Branch, tag, or full SHA", token: "Temporary Token (private repositories only)",
    tokenNote: "The Token is sent only with this sync request and is never stored.", excludes: "Additional excludes (one glob per line)", visibility: "Visibility", submit: "Sync revision", syncing: "Syncing and filtering archive…",
    empty: "No code Repository has been synced yet.", latest: "Latest stored revision", active: "Active approved revision", pending: "Wiki review has not activated this revision yet.", ragIndex: "Agent document index",
    again: "Sync again", save: "Save visibility", saving: "Saving…", success: "Repository revision stored.", refresh: "Refresh", failed: "The Repository request failed.",
    review: "Review Wiki", noDossier: "No generated Repository Wiki is ready for review.", coverage: "Analysis coverage", examined: "examined", eligible: "eligible files", targeted: "Targeted analysis does not claim full-repository coverage.",
    pages: "Wiki pages", preview: "Preview", edit: "Edit Markdown", savePage: "Save page", approve: "Approve as knowledge", approving: "Approving…", approved: "Wiki approved and added to Agent knowledge.", citations: "Source citations", outdated: "Analysis provenance is outdated; the active Wiki remains available until you approve a rerun.", analysis: "Repository analysis", rerun: "Rerun analysis", queued: "Repository analysis queued.", publicDeep: "Allow public deep analysis", publicDeepNote: "Visitors may start a bounded source analysis only while this Repository and the Agent remain public.",
  },
  zh: {
    kicker: "代码仓库知识", title: "代码仓库", intro: "固定一个不可变的 GitHub revision，审核生成的 Wiki，并在批准后将其加入智能体知识库。",
    connect: "添加仓库", connectCopy: "固定 GitHub 分支、标签或完整 commit SHA；私有仓库需要一次性 Token。", directory: "已添加仓库", close: "关闭添加仓库弹窗", cancel: "取消", url: "GitHub 仓库 URL", ref: "分支、标签或完整 SHA", token: "临时 Token（仅私有仓库需要）",
    tokenNote: "Token 只随本次同步请求发送，系统不会保存。", excludes: "额外排除规则（每行一个 glob）", visibility: "可见性", submit: "同步 revision", syncing: "正在同步并过滤 archive…",
    empty: "还没有同步代码仓库。", latest: "最新存储 revision", active: "当前已批准 revision", pending: "该 revision 尚未通过 Wiki 审核并激活。", ragIndex: "Agent 文档索引",
    again: "再次同步", save: "保存可见性", saving: "正在保存…", success: "Repository revision 已存储。", refresh: "刷新", failed: "代码仓库请求失败。",
    review: "审核 Wiki", noDossier: "暂无可审核的 Repository Wiki。", coverage: "分析覆盖", examined: "已检查", eligible: "个 eligible 文件", targeted: "本次是定向分析，不声称覆盖整个仓库。",
    pages: "Wiki 页面", preview: "预览", edit: "编辑 Markdown", savePage: "保存页面", approve: "批准并加入知识库", approving: "正在批准…", approved: "Wiki 已批准并加入智能体知识库。", citations: "源码 Citation", outdated: "分析运行版本已过期；在批准重跑结果前，当前 active Wiki 继续可用。", analysis: "仓库分析", rerun: "重新分析", queued: "仓库分析已进入队列。", publicDeep: "允许公共深度分析", publicDeepNote: "仅在该仓库与智能体保持公开时，访客才能启动有界源码分析。",
  },
} as const;

const visibilityLabels: Record<Visibility, { en: string; zh: string }> = {
  private: { en: "Private", zh: "私有" },
  agent_only: { en: "Agent only", zh: "仅智能体" },
  citation_allowed: { en: "Citation name only", zh: "仅引用名称" },
  public_preview: { en: "Public source preview", zh: "公开源码预览" },
};

function formatBytes(value: number, locale: Locale) {
  return new Intl.NumberFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { style: "unit", unit: value >= 1024 * 1024 ? "megabyte" : "kilobyte", maximumFractionDigits: 1 }).format(value >= 1024 * 1024 ? value / 1024 / 1024 : value / 1024);
}

export function RepositoriesClient({ initialRepositories, locale }: { initialRepositories: Repository[]; locale: Locale }) {
  const strings = locale === "zh-CN" ? copy.zh : copy.en;
  const language = locale === "zh-CN" ? "zh" : "en";
  const [repositories, setRepositories] = useState(initialRepositories);
  const [dossiers, setDossiers] = useState<Record<string, DossierReview>>({});
  const [selectedPages, setSelectedPages] = useState<Record<string, string>>({});
  const [wikiModes, setWikiModes] = useState<Record<string, "preview" | "edit">>({});
  const [addRepositoryOpen, setAddRepositoryOpen] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error"; message: string } | null>(null);
  const closeAddRepository = useCallback(() => {
    if (busy !== "new") setAddRepositoryOpen(false);
  }, [busy]);
  const addRepositoryDialogRef = useModalFocus(addRepositoryOpen, closeAddRepository, busy === "new");

  const refresh = useCallback(async () => {
    const { response, payload } = await requestApi<Envelope<{ items: Repository[] }>>("/api/repositories", { cache: "no-store" });
    if (!response.ok || !payload.data) throw new ApiClientError("invalid_response");
    setRepositories(payload.data.items);
  }, []);

  async function sync(event: FormEvent<HTMLFormElement>, repository?: Repository) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const target = repository ? `/api/repositories/${repository.id}/sync` : "/api/repositories";
    const body: Record<string, unknown> = {
      ref: String(data.get("ref") ?? "main"),
      excludePatterns: String(data.get("excludes") ?? "").split(/\r?\n/).map((value) => value.trim()).filter(Boolean),
    };
    if (!repository) {
      body.repositoryUrl = String(data.get("repositoryUrl") ?? "");
      body.visibility = String(data.get("visibility") ?? "private");
    }
    const token = String(data.get("token") ?? "").trim();
    if (token) body.token = token;
    setBusy(repository?.id ?? "new");
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<Envelope<Repository>>(target, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
      if (!response.ok) throw new Error(payload.error?.message ?? strings.failed);
      form.reset();
      await refresh();
      if (!repository) setAddRepositoryOpen(false);
      setFeedback({ tone: "success", message: strings.success });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : strings.failed });
    } finally {
      setBusy(null);
    }
  }

  async function changeVisibility(repository: Repository, visibility: Visibility) {
    setBusy(repository.id);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<Envelope<{ visibility: Visibility; publicDeepAnalysisEnabled: boolean }>>(`/api/repositories/${repository.id}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ visibility }) });
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? strings.failed);
      setRepositories((current) => current.map((item) => item.id === repository.id ? { ...item, visibility: payload.data!.visibility, publicDeepAnalysisEnabled: payload.data!.publicDeepAnalysisEnabled } : item));
      setFeedback({ tone: "success", message: strings.save });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : strings.failed });
    } finally {
      setBusy(null);
    }
  }

  async function changePublicDeep(repository: Repository, enabled: boolean) {
    setBusy(`public-deep:${repository.id}`);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<Envelope<{ publicDeepAnalysisEnabled: boolean }>>(`/api/repositories/${repository.id}`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ publicDeepAnalysisEnabled: enabled }),
      });
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? strings.failed);
      setRepositories((current) => current.map((item) => item.id === repository.id ? { ...item, publicDeepAnalysisEnabled: payload.data!.publicDeepAnalysisEnabled } : item));
      setFeedback({ tone: "success", message: strings.save });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : strings.failed });
    } finally {
      setBusy(null);
    }
  }

  async function loadDossier(repositoryId: string) {
    setBusy(`dossier:${repositoryId}`);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<Envelope<DossierReview>>(`/api/repositories/${repositoryId}/dossier`, { cache: "no-store" });
      if (!response.ok || !payload.data) throw new Error(payload.error?.message ?? strings.failed);
      setDossiers((current) => ({ ...current, [repositoryId]: payload.data! }));
      const firstPath = payload.data.dossier?.pages[0]?.path;
      if (firstPath) setSelectedPages((current) => ({ ...current, [repositoryId]: current[repositoryId] ?? firstPath }));
      return payload.data;
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : strings.failed });
      return null;
    } finally {
      setBusy(null);
    }
  }

  async function saveWikiPage(event: FormEvent<HTMLFormElement>, repository: Repository, page: WikiPage) {
    event.preventDefault();
    const data = new FormData(event.currentTarget);
    setBusy(`wiki-page:${page.id}`);
    setFeedback(null);
    try {
      const body = {
        pageId: page.id,
        editedMarkdown: String(data.get("markdown") ?? "").trim() || null,
      };
      const { response, payload } = await requestApi<Envelope<unknown>>(`/api/repositories/${repository.id}/dossier/projection`, {
        method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(payload.error?.message ?? strings.failed);
      await loadDossier(repository.id);
      setFeedback({ tone: "success", message: strings.savePage });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : strings.failed });
    } finally {
      setBusy(null);
    }
  }

  async function approveDossier(repository: Repository, dossierId: string) {
    setBusy(`approve:${repository.id}`);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<Envelope<unknown>>(`/api/repositories/${repository.id}/dossier/approve`, {
        method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ dossierId }),
      });
      if (!response.ok) throw new Error(payload.error?.message ?? strings.failed);
      await Promise.all([refresh(), loadDossier(repository.id)]);
      setFeedback({ tone: "success", message: strings.approved });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : strings.failed });
    } finally {
      setBusy(null);
    }
  }

  async function rerunAnalysis(repository: Repository) {
    setBusy(`rerun:${repository.id}`);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<Envelope<unknown>>(`/api/repositories/${repository.id}/dossier/rerun`, { method: "POST" });
      if (!response.ok) throw new Error(payload.error?.message ?? strings.failed);
      await refresh();
      setFeedback({ tone: "success", message: strings.queued });
    } catch (error) {
      setFeedback({ tone: "error", message: error instanceof Error ? error.message : strings.failed });
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="candidate-page repositories-page">
      <section className="page-hero compact-hero repository-hero">
        <p className="page-kicker">{strings.kicker}</p>
        <h1>{strings.title} <span className="title-seal" aria-hidden="true">职问</span></h1>
        <p>{strings.intro}</p>
      </section>
      {feedback && !addRepositoryOpen ? <div className={`inline-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.tone === "error" ? <AlertCircle size={18} /> : <Check size={18} />}{feedback.message}</div> : null}
      <section className="repository-directory" aria-labelledby="repository-directory-title">
        <div className="section-heading repository-directory-heading"><h2 id="repository-directory-title">{strings.directory}</h2><button className="secondary-button" type="button" onClick={() => { setFeedback(null); setAddRepositoryOpen(true); }}><Plus size={16} />{strings.connect}</button></div>
        <div className="repository-list" aria-live="polite">
          {repositories.length === 0 ? <div className="empty-state paper-card"><Github size={28} /><p>{strings.empty}</p></div> : repositories.map((repository) => (
          <article className="paper-card repository-card" key={repository.id}>
            <header><span className="round-icon"><Github size={19} /></span><div><h2>{repository.displayName}</h2><a href={repository.canonicalUrl} target="_blank" rel="noreferrer">{repository.canonicalUrl}</a></div><span className={`status-pill ${repository.latestRevision?.state ?? "staging"}`}>{repository.latestRevision?.state ?? "staging"}</span></header>
            {repository.latestRevision ? <dl><div><dt>{strings.latest}</dt><dd><code>{repository.latestRevision.commitSha}</code><small>{repository.latestRevision.requestedRef} · {repository.latestRevision.fileCount} files · {formatBytes(repository.latestRevision.extractedBytes, locale)}</small></dd></div><div><dt>{strings.active}</dt><dd>{repository.activeRevision ? <code>{repository.activeRevision.commitSha}</code> : <small>{strings.pending}</small>}</dd></div><div><dt>{strings.ragIndex}</dt><dd><span className={`status-pill ${repository.ragIndexState}`}>{repository.ragIndexState}</span><small>{repository.ragIndexCommitSha ? repository.ragIndexCommitSha.slice(0, 12) : "—"} · {repository.ragIndexedFileCount} indexed · {repository.ragSkippedFileCount} skipped{repository.ragIndexErrorCode ? ` · ${repository.ragIndexErrorCode}` : ""}</small>{repository.ragIndexWarnings.length > 0 ? <small>{repository.ragIndexWarnings.join(", ")}</small> : null}</dd></div></dl> : null}
            <div className="repository-card-actions">
              <label><span>{strings.visibility}</span><select value={repository.visibility} disabled={busy === repository.id} onChange={(event) => void changeVisibility(repository, event.target.value as Visibility)}>{(Object.keys(visibilityLabels) as Visibility[]).map((value) => <option key={value} value={value}>{visibilityLabels[value][language]}</option>)}</select></label>
              <label className="checkbox-label repository-public-deep"><input type="checkbox" checked={repository.publicDeepAnalysisEnabled} disabled={busy !== null || !["citation_allowed", "public_preview"].includes(repository.visibility)} onChange={(event) => void changePublicDeep(repository, event.target.checked)} /><span><strong>{strings.publicDeep}</strong><small>{strings.publicDeepNote}</small></span></label>
              <details><summary className="secondary-button"><RefreshCw size={16} />{strings.again}</summary><form className="repository-resync-form" onSubmit={(event) => void sync(event, repository)}><label><span>{strings.ref}</span><input name="ref" required defaultValue={repository.latestRevision?.requestedRef ?? "main"} /></label><label><span>{strings.token}</span><input name="token" type="password" autoComplete="off" /></label><label><span>{strings.excludes}</span><textarea name="excludes" rows={2} /></label><button className="primary-button" type="submit" disabled={busy === repository.id}>{busy === repository.id ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{strings.again}</button></form></details>
            </div>
            <p className="privacy-note"><ShieldCheck size={17} />{strings.tokenNote}</p>
            <div className="repository-dossier-review">
              <div className="repository-analysis-status">
                <div><strong>{strings.analysis}</strong>{repository.latestAnalysisRun ? <span className={`status-pill ${repository.latestAnalysisRun.state}`}>{repository.latestAnalysisRun.state} · {repository.latestAnalysisRun.phase}</span> : <small>{strings.noDossier}</small>}</div>
                <button className="secondary-button" type="button" disabled={busy !== null || repository.visibility === "private"} onClick={() => void rerunAnalysis(repository)}>{busy === `rerun:${repository.id}` ? <LoaderCircle className="spin" size={16} /> : <RefreshCw size={16} />}{strings.rerun}</button>
              </div>
              <button className="secondary-button" type="button" disabled={busy !== null} onClick={() => void loadDossier(repository.id)}>{busy === `dossier:${repository.id}` ? <LoaderCircle className="spin" size={16} /> : <FileSearch size={16} />}{strings.review}</button>
              {Object.hasOwn(dossiers, repository.id) ? (() => {
                const dossier = dossiers[repository.id]?.dossier;
                if (!dossier) return <p className="dossier-empty">{strings.noDossier}</p>;
                const selectedPath = selectedPages[repository.id] ?? dossier.pages[0]?.path;
                const page = dossier.pages.find((candidate) => candidate.path === selectedPath) ?? dossier.pages[0];
                const mode = dossier.isActive ? "preview" : (wikiModes[repository.id] ?? "preview");
                return (
                  <section className="dossier-panel wiki-panel" aria-label={`${repository.displayName} Wiki`}>
                    <div className="dossier-heading">
                      <div><p className="page-kicker">Generated Version {dossier.generatedVersion}</p><h3>{dossier.title}</h3><p>{dossier.summary}</p><code>{dossier.commitSha}</code></div>
                      <span className={`status-pill ${dossier.isActive ? "active" : "review_pending"}`}>{dossier.isActive ? "active knowledge" : "review pending"}</span>
                    </div>
                    {dossier.outdatedReason ? <p className="inline-feedback error" role="status"><AlertCircle size={17} />{strings.outdated}</p> : null}
                    <div className="dossier-coverage">
                      <strong>{strings.coverage}</strong>
                      <span>{dossier.coverage.examinedFileCount ?? 0} {strings.examined} / {dossier.coverage.eligibleFileCount ?? 0} {strings.eligible}</span>
                      {dossier.coverage.analysisMode === "targeted" ? <small>{strings.targeted}</small> : null}
                    </div>
                    <div className="wiki-workspace">
                      <nav className="wiki-page-nav" aria-label={strings.pages}>
                        <strong>{strings.pages}</strong>
                        {dossier.pages.map((candidate) => <button key={candidate.id} className={candidate.id === page?.id ? "active" : ""} type="button" onClick={() => setSelectedPages((current) => ({ ...current, [repository.id]: candidate.path }))}><FileText size={15} /><span>{candidate.title}<small>{candidate.path}</small></span></button>)}
                      </nav>
                      {page ? <section className="wiki-page-review">
                        <header><div><h4>{page.title}</h4><code>{page.path}</code></div><div className="wiki-mode-tabs"><button className={mode === "preview" ? "active" : ""} type="button" onClick={() => setWikiModes((current) => ({ ...current, [repository.id]: "preview" }))}><FileSearch size={14} />{strings.preview}</button>{!dossier.isActive ? <button className={mode === "edit" ? "active" : ""} type="button" onClick={() => setWikiModes((current) => ({ ...current, [repository.id]: "edit" }))}><Pencil size={14} />{strings.edit}</button> : null}</div></header>
                        {mode === "preview" ? <MarkdownContent className="wiki-markdown-preview" content={page.editedMarkdown ?? page.generatedMarkdown} /> : <form className="wiki-page-editor" key={`${page.id}:${page.editedMarkdown ?? "generated"}`} onSubmit={(event) => void saveWikiPage(event, repository, page)}><textarea name="markdown" defaultValue={page.editedMarkdown ?? page.generatedMarkdown} spellCheck={false} /><button className="secondary-button" type="submit" disabled={busy !== null}>{busy === `wiki-page:${page.id}` ? <LoaderCircle className="spin" size={15} /> : <Check size={15} />}{strings.savePage}</button></form>}
                        {page.citations.length > 0 ? <details className="dossier-citations"><summary>{strings.citations} ({page.citations.length})</summary><ul>{page.citations.map((citation) => <li key={citation.marker}><strong>[{citation.marker}]</strong> <code>{citation.path}:{citation.lineStart}-{citation.lineEnd}</code></li>)}</ul></details> : null}
                      </section> : null}
                    </div>
                    {!dossier.isActive ? <button className="primary-button" type="button" disabled={repository.visibility === "private" || busy !== null} onClick={() => void approveDossier(repository, dossier.id)}>{busy === `approve:${repository.id}` ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{busy === `approve:${repository.id}` ? strings.approving : strings.approve}</button> : null}
                  </section>
                );
              })() : null}
            </div>
          </article>
          ))}
        </div>
      </section>
      {addRepositoryOpen ? <div className="repository-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeAddRepository(); }}><section ref={addRepositoryDialogRef} className="repository-dialog" role="dialog" aria-modal="true" aria-labelledby="repository-sync-title" aria-describedby="repository-sync-copy" tabIndex={-1}>
        <header><span><Github size={20} /></span><div><p className="page-kicker">GitHub.com</p><h2 id="repository-sync-title">{strings.connect}</h2><p id="repository-sync-copy">{strings.connectCopy}</p></div><button type="button" onClick={closeAddRepository} disabled={busy === "new"} aria-label={strings.close}><X size={18} /></button></header>
        <form className="repository-sync-form" onSubmit={(event) => void sync(event)}>
          <label><span>{strings.url}</span><input name="repositoryUrl" type="url" required data-autofocus placeholder="https://github.com/owner/repository" /></label>
          <label><span>{strings.ref}</span><input name="ref" required defaultValue="main" /></label>
          <label><span>{strings.token}</span><input name="token" type="password" autoComplete="off" /><small>{strings.tokenNote}</small></label>
          <label><span>{strings.visibility}</span><select name="visibility" defaultValue="private">{(Object.keys(visibilityLabels) as Visibility[]).map((value) => <option key={value} value={value}>{visibilityLabels[value][language]}</option>)}</select></label>
          <label className="repository-excludes"><span>{strings.excludes}</span><textarea name="excludes" rows={3} placeholder="generated/**" /></label>
          {feedback?.tone === "error" ? <p className="repository-dialog-error" role="alert"><AlertCircle size={16} />{feedback.message}</p> : null}
          <footer><button className="secondary-button" type="button" onClick={closeAddRepository} disabled={busy === "new"}>{strings.cancel}</button><button className="primary-button" type="submit" disabled={busy !== null}>{busy === "new" ? <LoaderCircle className="spin" size={17} /> : <Github size={17} />}{busy === "new" ? strings.syncing : strings.submit}</button></footer>
        </form>
      </section></div> : null}
    </div>
  );
}
