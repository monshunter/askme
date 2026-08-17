"use client";

import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  CircleUserRound,
  FileText,
  Globe2,
  LoaderCircle,
  MessageSquareText,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { createTranslator, type Locale } from "@/i18n/core";
import { MarkdownContent } from "@/components/markdown-content";
import { CandidateSourceLink, SourceLink } from "@/components/source-viewer";
import { useModalFocus } from "@/components/use-modal-focus";

import { ApiClientError, requestApi } from "./api-client";
import { AgentPublicationControls, type PublicationOverview } from "./agent-publication-controls";

type Visibility = "private" | "agent_only" | "citation_allowed" | "public_preview";
type DocumentCitation = {
  kind?: "document";
  chunkId: string;
  rank: number;
  excerpt: string;
  materialId: string;
  materialTitle: string;
  materialKind: "file" | "notion" | "website";
  mimeType: string | null;
  externalUrl: string | null;
  visibility: Visibility;
};
type RepositoryCitation = {
  kind: "repository";
  messageId: string;
  rank: number;
  repositoryId: string;
  repositoryTitle: string;
  revisionId: string;
  commitSha: string;
  path: string;
  lineStart: number;
  lineEnd: number;
  visibility: Visibility;
};
type Citation = DocumentCitation | RepositoryCitation;
type RetrievalTrace = {
  id: string;
  policyVersion: string;
  indexVersionId: string | null;
  planner: { entities?: string[]; mustTerms?: string[]; shouldTerms?: string[]; semanticQueryCount?: number; desiredEvidenceTypes?: string[]; unsupportedAspects?: string[] };
  routeCounts: Array<{ exact: number; lexical: number; vector: number; structured: number }>;
  selectedEvidence: Array<{ evidenceId: string; sourceKind: string; title: string; path: string | null; score: number; routeRanks: Record<string, number> }>;
  coverage: string;
  roundCount: number;
  degradations: string[];
  configuredEvidenceTokens: number;
  effectiveEvidenceTokens: number;
  actualEvidenceTokens: number;
  latencyMs: number;
};
type AgentMessage = {
  id: string;
  role: "user" | "assistant";
  status: "pending" | "completed" | "failed";
  content: string;
  model: string | null;
  errorCode: string | null;
  replyToMessageId: string | null;
  createdAt: string;
  feedback: "up" | "down" | null;
  citations: Citation[];
  analysisRun: { id: string; version: number; state: "pending" | "running" | "completed" | "failed" | "cancelled"; phase: string } | null;
  retrievalTrace: RetrievalTrace | null;
};
type PreviewThread = {
  conversation: { id: string; createdAt: string; lastActivityAt: string };
  messages: AgentMessage[];
  suggestedQuestions: string[];
  idempotent?: boolean;
  pending?: boolean;
};
type AgentSettings = {
  answerTone: "professional" | "concise" | "conversational";
  publicMode: boolean;
  privacySafeMode: boolean;
  profileMaterialId: string | null;
  updatedAt: string;
};
type ProfileMaterialItem = {
  id: string;
  title: string;
  mimeType: string | null;
  kind: "file";
  visibility: Visibility;
};
type HighlightKnowledgeType = "project" | "experience" | "skill" | "article" | "repository" | "summary";
type FeaturedHighlightItem = {
  id: string;
  type: HighlightKnowledgeType;
  title: string;
  summary: string;
  highlights: string[];
  eligible: boolean;
};
type HighlightCandidateItem = {
  id: string;
  type: HighlightKnowledgeType;
  title: string;
  summary: string;
  highlights: string[];
  confidence: number;
};
type HighlightCuration = {
  featured: FeaturedHighlightItem[];
  items: HighlightCandidateItem[];
  page: number;
  totalPages: number;
};
type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string } | null };

function connectionFeedback(error: unknown, action: string, locale: Locale) {
  const t = createTranslator(locale);
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? t("agent.connectionInvalid", { action })
    : t("agent.connectionFailed", { action });
}

function timeLabel(value: string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(value));
}

function visibilityLabel(visibility: Visibility, locale: Locale) {
  const t = createTranslator(locale);
  if (visibility === "agent_only") return t("agent.visibility.agent");
  if (visibility === "public_preview") return t("agent.visibility.public");
  if (visibility === "citation_allowed") return t("agent.visibility.citation");
  return t("agent.visibility.private");
}

export function AgentPreviewClient({ initialThread, initialSettings, initialPublicationOverview, initialHighlights, locale }: { initialThread: PreviewThread; initialSettings: AgentSettings; initialPublicationOverview: PublicationOverview; initialHighlights: HighlightCuration; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [thread, setThread] = useState(initialThread);
  const [settings, setSettings] = useState(initialSettings);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false);
  const [savingSetting, setSavingSetting] = useState<keyof Pick<AgentSettings, "answerTone" | "publicMode" | "privacySafeMode" | "profileMaterialId"> | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState<string | null>(null);
  const [resetting, setResetting] = useState(false);
  const [pendingReset, setPendingReset] = useState(false);
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const [highlights, setHighlights] = useState(initialHighlights);
  const [highlightPage, setHighlightPage] = useState(initialHighlights.page);
  const [savingHighlights, setSavingHighlights] = useState(false);
  const [rotatingHighlights, setRotatingHighlights] = useState(false);
  const [profileMaterials, setProfileMaterials] = useState<ProfileMaterialItem[]>([]);
  const [profileLoading, setProfileLoading] = useState(true);
  const runEvents = useRef(new Map<string, EventSource>());
  const resetDialogRef = useModalFocus(pendingReset, () => setPendingReset(false), resetting);

  const assistantMessages = useMemo(() => thread.messages.filter((message) => message.role === "assistant"), [thread.messages]);
  const activeAnswer = useMemo(
    () => assistantMessages.find((message) => message.id === selectedAnswerId) ?? [...assistantMessages].reverse().find((message) => message.citations.length > 0) ?? assistantMessages.at(-1) ?? null,
    [assistantMessages, selectedAnswerId],
  );

  const refreshThread = useCallback(async () => {
    const { response, payload } = await requestApi<ApiEnvelope<PreviewThread>>("/api/agent/preview", { cache: "no-store" });
    if (!response.ok) throw new Error(t("agent.refreshFailed"));
    if (!payload.data) throw new ApiClientError("invalid_response");
    setThread(payload.data);
    return payload.data;
  }, [t]);

  const watchAnalysisRun = useCallback((runId: string) => {
    if (runEvents.current.has(runId)) return;
    const source = new EventSource(`/api/agent/analysis-runs/${runId}/events`);
    runEvents.current.set(runId, source);
    const settle = () => {
      source.close();
      runEvents.current.delete(runId);
      void refreshThread().catch(() => setNotice({ tone: "error", message: t("agent.refreshFailed") }));
    };
    source.addEventListener("run", (event) => {
      try {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as { completed?: unknown };
        if (snapshot.completed === true) settle();
      } catch { settle(); }
    });
    source.addEventListener("invalidated", settle);
  }, [refreshThread, t]);

  useEffect(() => {
    for (const message of thread.messages) {
      if (message.status === "pending" && !message.errorCode && message.analysisRun && (message.analysisRun.state === "pending" || message.analysisRun.state === "running")) {
        watchAnalysisRun(message.analysisRun.id);
      }
    }
  }, [thread.messages, watchAnalysisRun]);

  const closeRunEvents = useCallback(() => {
    for (const source of runEvents.current.values()) source.close();
    runEvents.current.clear();
  }, []);

  useEffect(() => closeRunEvents, [closeRunEvents]);

  const selectedProfileMaterial = useMemo(() => profileMaterials.find((item) => item.id === settings.profileMaterialId) ?? null, [profileMaterials, settings.profileMaterialId]);

  useEffect(() => {
    let cancelled = false;
    void requestApi<ApiEnvelope<{ items: Array<{ id: string; title: string; mimeType: string | null; kind: "file" | "notion" | "website"; visibility: Visibility }> }>>(
      "/api/materials?pageSize=100&status=indexed&kind=file",
      { cache: "no-store" },
    ).then(({ response, payload }) => {
      if (cancelled || !response.ok || !payload.data) return;
      setProfileMaterials(payload.data.items.filter((item) => item.kind === "file" && item.visibility === "public_preview").map((item) => ({ id: item.id, title: item.title, mimeType: item.mimeType, kind: "file" as const, visibility: item.visibility })));
    }).catch(() => undefined).finally(() => {
      if (!cancelled) setProfileLoading(false);
    });
    return () => { cancelled = true; };
  }, []);

  async function sendQuestion(value: string) {
    const normalized = value.trim();
    if (!normalized || sending) return;
    setSending(true);
    setNotice(null);
    setRetryQuestion(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<PreviewThread>>("/api/agent/preview/chat", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          clientMessageId: crypto.randomUUID(),
          ...(thread.conversation?.id ? { conversationId: thread.conversation.id } : {}),
          question: normalized,
        }),
      });
      if (!response.ok) {
        await refreshThread().catch(() => undefined);
        setRetryQuestion(normalized);
        setNotice({ tone: "error", message: t("agent.answerFailed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setThread(payload.data);
      const newestAnswer = [...payload.data.messages].reverse().find((message) => message.role === "assistant");
      setSelectedAnswerId(newestAnswer?.id ?? null);
      setQuestion("");
    } catch (error) {
      setRetryQuestion(normalized);
      setNotice({ tone: "error", message: connectionFeedback(error, t("agent.action.answer"), locale) });
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(question);
  }

  async function updateSetting<Key extends "answerTone" | "publicMode" | "privacySafeMode" | "profileMaterialId">(key: Key, value: AgentSettings[Key]) {
    const previous = settings;
    setSavingSetting(key);
    setSettings((current) => ({ ...current, [key]: value }));
    setNotice(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<AgentSettings>>("/api/agent/settings", {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ [key]: value }),
      });
      if (!response.ok) {
        setSettings(previous);
        setNotice({ tone: "error", message: payload.error?.code === "MATERIAL_NOT_ELIGIBLE" ? t("agent.profile.ineligible") : t("agent.settingFailed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setSettings(payload.data);
      setNotice({ tone: "success", message: t("agent.settingSaved") });
    } catch (error) {
      setSettings(previous);
      setNotice({ tone: "error", message: connectionFeedback(error, t("agent.action.settings"), locale) });
    } finally {
      setSavingSetting(null);
    }
  }

  async function refreshSuggestions() {
    setRefreshingSuggestions(true);
    setNotice(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<{ suggestedQuestions: string[] }>>("/api/agent/settings/suggestions/refresh", { method: "POST" });
      if (!response.ok) {
        setNotice({ tone: "error", message: t("agent.suggestionsFailed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setThread((current) => ({ ...current, suggestedQuestions: payload.data!.suggestedQuestions }));
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t("agent.action.suggestions"), locale) });
    } finally {
      setRefreshingSuggestions(false);
    }
  }

  async function rotateHighlights() {
    setRotatingHighlights(true);
    setNotice(null);
    try {
      const next = highlights.totalPages <= 1 ? 1 : (highlightPage % highlights.totalPages) + 1;
      const { response, payload } = await requestApi<ApiEnvelope<HighlightCuration>>(`/api/agent/highlights?page=${next}`, { cache: "no-store" });
      if (!response.ok) {
        setNotice({ tone: "error", message: t("agent.highlights.rotateFailed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setHighlights(payload.data);
      setHighlightPage(next);
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t("agent.action.highlights"), locale) });
    } finally {
      setRotatingHighlights(false);
    }
  }

  async function toggleHighlight(item: { id: string }, feature: boolean) {
    if (savingHighlights) return;
    if (feature && highlights.featured.length >= 5) {
      setNotice({ tone: "error", message: t("agent.highlights.limit") });
      return;
    }
    setSavingHighlights(true);
    setNotice(null);
    try {
      const nextIds = feature
        ? [...highlights.featured.map((featured) => featured.id), item.id]
        : highlights.featured.filter((featured) => featured.id !== item.id).map((featured) => featured.id);
      const { response, payload } = await requestApi<ApiEnvelope<{ featured: FeaturedHighlightItem[] }>>("/api/agent/highlights", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ knowledgeItemIds: nextIds }),
      });
      if (!response.ok) {
        setNotice({ tone: "error", message: payload.error?.code === "HIGHLIGHT_LIMIT_EXCEEDED" ? t("agent.highlights.limit") : payload.error?.code === "HIGHLIGHT_NOT_ELIGIBLE" ? t("agent.highlights.ineligible") : t("agent.highlights.failed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setHighlights((current) => ({
        ...current,
        featured: payload.data!.featured,
        items: feature ? current.items.filter((candidate) => candidate.id !== item.id) : current.items,
      }));
      setNotice({ tone: "success", message: t("agent.highlights.saved") });
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t("agent.action.highlights"), locale) });
    } finally {
      setSavingHighlights(false);
    }
  }

  async function saveFeedback(message: AgentMessage, value: "up" | "down") {
    setFeedbackSaving(message.id);
    setNotice(null);
    try {
      const { response } = await requestApi<ApiEnvelope<{ value: "up" | "down" }>>(`/api/agent/messages/${message.id}/feedback`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) {
        setNotice({ tone: "error", message: t("agent.feedbackFailed") });
        return;
      }
      setThread((current) => ({ ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, feedback: value } : item) }));
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t("agent.action.feedback"), locale) });
    } finally {
      setFeedbackSaving(null);
    }
  }

  async function resetPreview() {
    if (resetting || sending) return;
    setResetting(true);
    setNotice(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<PreviewThread>>("/api/agent/preview", { method: "DELETE" });
      if (!response.ok) {
        setNotice({ tone: "error", message: payload.error?.code === "PREVIEW_SESSION_BUSY" ? t("agent.reset.busy") : t("agent.reset.failed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      closeRunEvents();
      setThread(payload.data);
      setQuestion("");
      setSelectedAnswerId(null);
      setRetryQuestion(null);
      setPendingReset(false);
      setNotice({ tone: "success", message: t("agent.reset.success") });
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t("agent.action.reset"), locale) });
    } finally {
      setResetting(false);
    }
  }

  return (
    <div className="candidate-page agent-preview-page">
      <section className="page-hero compact-hero agent-hero">
        <p className="page-kicker">{t("agent.kicker")}</p>
        <h1>{t("agent.title")} <span className="title-seal" aria-hidden="true">职问</span></h1>
        <p>{t("agent.copy")}</p>
        <span className="agent-evidence-note"><ShieldCheck size={18} /> {t("agent.evidence")}</span>
      </section>

      {notice ? <div className={`inline-feedback ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.tone === "error" ? <AlertCircle size={18} /> : notice.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{notice.message}{retryQuestion ? <button className="inline-retry" type="button" disabled={sending} onClick={() => void sendQuestion(retryQuestion)}><RefreshCw size={15} /> {t("agent.retry")}</button> : null}<button type="button" onClick={() => setNotice(null)} aria-label={t("shared.dismiss")}><X size={16} /></button></div> : null}

      <div className="agent-preview-grid">
        <section className="paper-card agent-chat-card" aria-label={t("agent.conversation")}>
          <header className="agent-chat-toolbar"><strong>{t("agent.conversation")}</strong><button type="button" disabled={sending || resetting} onClick={() => setPendingReset(true)}><RotateCcw size={15} /> {t("agent.reset.button")}</button></header>
          <div className="agent-thread" aria-live="polite">
            {thread.messages.length === 0 ? (
              <div className="empty-state agent-empty"><span><Bot size={28} /></span><h2>{t("agent.empty.title")}</h2><p>{t("agent.empty.copy")}</p></div>
            ) : thread.messages.map((message) => message.role === "user" ? (
              <article className="chat-message user-message" key={message.id}>
                <span className="chat-avatar user"><CircleUserRound size={24} /></span>
                <div><MarkdownContent content={message.content} /><time dateTime={message.createdAt}>{timeLabel(message.createdAt, locale)}</time></div>
              </article>
            ) : (
              <article className={`chat-message assistant-message ${message.status}`} key={message.id} onClick={() => setSelectedAnswerId(message.id)}>
                <span className="chat-avatar agent"><Bot size={22} /></span>
                <div className="assistant-bubble">
                  {message.status === "pending" ? <p className="answer-status"><LoaderCircle className="spin" size={16} /> {t("agent.grounding")}</p> : <MarkdownContent content={message.content} />}
                  {message.errorCode ? <span className={`answer-outcome ${message.status}`}>{message.errorCode === "INSUFFICIENT_EVIDENCE" ? t("agent.outcome.moreEvidence") : message.errorCode === "REFUSED" ? t("agent.outcome.refused") : t("agent.outcome.failed")}</span> : null}
                  <footer>
                    <span>{message.citations.length > 0 ? t("agent.citedSources", { count: message.citations.length }) : message.status === "completed" ? t("agent.noSource") : ""}</span>
                    {message.status === "completed" ? <span className="answer-feedback" aria-label={t("agent.rate")}><button className={message.feedback === "up" ? "active" : ""} type="button" disabled={feedbackSaving === message.id} onClick={(event) => { event.stopPropagation(); void saveFeedback(message, "up"); }} aria-label={t("agent.helpful")}><ThumbsUp size={15} /></button><button className={message.feedback === "down" ? "active" : ""} type="button" disabled={feedbackSaving === message.id} onClick={(event) => { event.stopPropagation(); void saveFeedback(message, "down"); }} aria-label={t("agent.unhelpful")}><ThumbsDown size={15} /></button></span> : null}
                  </footer>
                </div>
              </article>
            ))}
          </div>

          <form className="agent-composer" onSubmit={submit}>
            <label htmlFor="agent-question">{t("agent.question.label")}</label>
            <div><textarea id="agent-question" value={question} maxLength={500} rows={2} disabled={sending} onChange={(event) => setQuestion(event.target.value)} placeholder={t("agent.question.placeholder")} /><button type="submit" disabled={sending || !question.trim()} aria-label={t("agent.question.send")}>{sending ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}</button></div>
            <small>{t("agent.question.context", { count: question.length })}</small>
          </form>

          <section className="suggestion-section" aria-labelledby="suggestion-title">
            <div><h2 id="suggestion-title">{t("agent.suggestions.title")}</h2><button type="button" disabled={refreshingSuggestions} onClick={() => void refreshSuggestions()}>{refreshingSuggestions ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} {t("agent.suggestions.refresh")}</button></div>
            <div className="suggestion-grid">{thread.suggestedQuestions.map((suggestion) => <button type="button" key={suggestion} disabled={sending} onClick={() => void sendQuestion(suggestion)}><MessageSquareText size={16} />{suggestion}</button>)}</div>
          </section>
        </section>

        <aside className="paper-card citations-card" aria-label={t("agent.citations.label")}>
          <header><span><h2>{t("agent.citations.title")}</h2><small>{activeAnswer ? t("agent.citations.used") : t("agent.citations.select")}</small></span><strong>{t("agent.citations.count", { count: activeAnswer?.citations.length ?? 0 })}</strong></header>
          {!activeAnswer || activeAnswer.citations.length === 0 ? <div className="empty-state citations-empty"><FileText size={26} /><p>{t("agent.citations.empty")}</p><small>{t("agent.citations.copy")}</small></div> : (
            <ol className="citation-list">{activeAnswer.citations.map((citation) => citation.kind === "repository" ? (
              <li key={`${citation.messageId}:${citation.rank}`}><span className="citation-rank">{citation.rank}</span><span className="citation-file"><FileText size={19} /></span><div><SourceLink title={`${citation.repositoryTitle} · ${citation.path}:${citation.lineStart}-${citation.lineEnd}`} href={`/api/repositories/${citation.repositoryId}/source?${new URLSearchParams({ messageId: citation.messageId, revisionId: citation.revisionId, path: citation.path, lineStart: String(citation.lineStart), lineEnd: String(citation.lineEnd) }).toString()}`} mode="repository" locale={locale} /><small>REPOSITORY · {visibilityLabel(citation.visibility, locale)} · {citation.commitSha.slice(0, 12)}</small></div></li>
            ) : (
              <li key={citation.chunkId}><span className="citation-rank">{citation.rank}</span><span className="citation-file"><FileText size={19} /></span><div><CandidateSourceLink materialId={citation.materialId} title={citation.materialTitle} kind={citation.materialKind} mimeType={citation.mimeType} externalUrl={citation.externalUrl} locale={locale} /><small>{citation.materialKind.toUpperCase()} · {visibilityLabel(citation.visibility, locale)}</small><p>{citation.excerpt}</p></div></li>
            ))}</ol>
          )}
          {activeAnswer?.retrievalTrace ? <details className="retrieval-trace-panel"><summary>{locale === "zh-CN" ? "检索 Trace" : "Retrieval trace"}</summary><dl><div><dt>Coverage</dt><dd>{activeAnswer.retrievalTrace.coverage}</dd></div><div><dt>Rounds</dt><dd>{activeAnswer.retrievalTrace.roundCount}</dd></div><div><dt>Policy</dt><dd><code>{activeAnswer.retrievalTrace.policyVersion}</code></dd></div><div><dt>Routes</dt><dd>{activeAnswer.retrievalTrace.routeCounts.map((route, index) => <code key={index}>#{index + 1} E{route.exact}/L{route.lexical}/V{route.vector}/S{route.structured}</code>)}</dd></div><div><dt>Evidence</dt><dd>{activeAnswer.retrievalTrace.selectedEvidence.map((item) => <code key={item.evidenceId}>{item.sourceKind} · {item.title}</code>)}</dd></div><div><dt>Budget</dt><dd>{activeAnswer.retrievalTrace.actualEvidenceTokens}/{activeAnswer.retrievalTrace.effectiveEvidenceTokens}</dd></div>{activeAnswer.retrievalTrace.degradations.length > 0 ? <div><dt>Degradation</dt><dd>{activeAnswer.retrievalTrace.degradations.join(", ")}</dd></div> : null}</dl></details> : null}
          <Link className="knowledge-deep-link" href="/workspace/knowledge"><FileText size={17} /> {t("agent.citations.viewAll")} <ChevronRight size={17} /></Link>
        </aside>
      </div>

      <section className="agent-settings-grid" aria-label={t("agent.settings.label")}>
        <label className="paper-card agent-setting"><span className="setting-icon"><Sparkles size={19} /></span><span><strong>{t("agent.settings.tone")}</strong><small>{t("agent.settings.toneCopy")}</small></span><select value={settings.answerTone} disabled={savingSetting === "answerTone"} onChange={(event) => void updateSetting("answerTone", event.target.value as AgentSettings["answerTone"])}><option value="professional">{t("agent.settings.professional")}</option><option value="concise">{t("agent.settings.concise")}</option><option value="conversational">{t("agent.settings.conversational")}</option></select></label>
        <label className="paper-card agent-setting"><span className="setting-icon"><Globe2 size={19} /></span><span><strong>{t("agent.settings.public")}</strong><small>{t("agent.settings.publicCopy")}</small></span><select value={settings.publicMode ? "on" : "off"} disabled={savingSetting === "publicMode"} onChange={(event) => void updateSetting("publicMode", event.target.value === "on")}><option value="on">{t("agent.settings.on")}</option><option value="off">{t("agent.settings.off")}</option></select></label>
        <label className="paper-card agent-setting"><span className="setting-icon"><ShieldCheck size={19} /></span><span><strong>{t("agent.settings.privacy")}</strong><small>{t("agent.settings.privacyCopy")}</small></span><select value={settings.privacySafeMode ? "on" : "off"} disabled={savingSetting === "privacySafeMode"} onChange={(event) => void updateSetting("privacySafeMode", event.target.value === "on")}><option value="on">{t("agent.settings.on")}</option><option value="off">{t("agent.settings.off")}</option></select></label>
      </section>

      <section className="agent-profile-panel paper-card" aria-labelledby="agent-profile-title">
        <header className="agent-profile-heading"><span className="setting-icon"><FileText size={19} /></span><span><h2 id="agent-profile-title">{t("agent.profile.title")}</h2><p>{t("agent.profile.copy")}</p></span></header>
        {settings.profileMaterialId ? <div className="agent-profile-current"><span className="agent-profile-current-label">{t("agent.profile.current")}</span><CandidateSourceLink materialId={settings.profileMaterialId} title={selectedProfileMaterial?.title ?? t("agent.profile.unknown")} kind="file" mimeType={selectedProfileMaterial?.mimeType ?? null} externalUrl={null} locale={locale} />{!selectedProfileMaterial ? <p className="agent-profile-stale">{t("agent.profile.stale")}</p> : null}<button className="secondary-button" type="button" disabled={savingSetting === "profileMaterialId"} onClick={() => void updateSetting("profileMaterialId", null)}>{savingSetting === "profileMaterialId" ? <LoaderCircle className="spin" size={15} /> : <X size={15} />} {t("agent.profile.clear")}</button></div> : null}
        {profileLoading ? <p className="agent-profile-status"><LoaderCircle className="spin" size={15} /> {t("shared.loading")}</p> : profileMaterials.length === 0 ? <div className="agent-profile-empty"><p>{t("agent.profile.empty")}</p><Link className="secondary-button" href="/workspace/privacy">{t("agent.profile.manage")}</Link></div> : (
          <ul className="agent-profile-list">{profileMaterials.map((item) => (
            <li key={item.id} className={item.id === settings.profileMaterialId ? "selected" : ""}>
              <span className="agent-profile-file"><FileText size={16} /></span>
              <div><strong>{item.title}</strong>{item.mimeType ? <small>{item.mimeType}</small> : null}</div>
              <button type="button" disabled={savingSetting === "profileMaterialId" || item.id === settings.profileMaterialId} onClick={() => void updateSetting("profileMaterialId", item.id)}>{t("agent.profile.pick")}</button>
            </li>
          ))}</ul>
        )}
      </section>

      <section className="agent-highlights-panel paper-card" aria-labelledby="agent-highlights-title">
        <header className="agent-highlights-heading"><span className="setting-icon"><Sparkles size={19} /></span><span><h2 id="agent-highlights-title">{t("agent.highlights.title")}</h2><p>{t("agent.highlights.copy")}</p></span><strong>{t("agent.highlights.count", { count: highlights.featured.length })}</strong></header>
        <div className="agent-highlights-columns">
          <section className="agent-highlights-featured" aria-labelledby="agent-highlights-featured-title">
            <div className="agent-highlights-toolbar"><h3 id="agent-highlights-featured-title">{t("agent.highlights.featured")}</h3></div>
            {highlights.featured.length === 0 ? <p className="agent-highlights-empty">{t("agent.highlights.featuredEmpty")}</p> : <ul className="agent-highlight-list">{highlights.featured.map((item) => (
              <li className="agent-highlight-item" key={item.id}>
                <div><strong>{item.title}</strong>{!item.eligible ? <small className="agent-highlight-warning">{t("agent.highlights.ineligible")}</small> : null}<p>{item.summary}</p>{item.highlights.length > 0 ? <ul className="agent-highlight-lines">{item.highlights.map((line, index) => <li key={`${line}-${index}`}><Check size={12} />{line}</li>)}</ul> : null}</div>
                <button type="button" disabled={savingHighlights} onClick={() => void toggleHighlight(item, false)} aria-label={t("agent.highlights.remove")}><X size={15} /></button>
              </li>
            ))}</ul>}
          </section>
          <section className="agent-highlights-pool" aria-labelledby="agent-highlights-pool-title">
            <div className="agent-highlights-toolbar"><h3 id="agent-highlights-pool-title">{t("agent.highlights.pool")}</h3><button type="button" disabled={rotatingHighlights || highlights.items.length === 0} onClick={() => void rotateHighlights()}>{rotatingHighlights ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} {t("agent.highlights.rotate")}</button></div>
            {highlights.items.length === 0 ? <p className="agent-highlights-empty">{t("agent.highlights.poolEmpty")}</p> : <ul className="agent-highlight-list">{highlights.items.map((item) => (
              <li className="agent-highlight-item" key={item.id}>
                <div><strong>{item.title}</strong><p>{item.summary}</p>{item.highlights.length > 0 ? <ul className="agent-highlight-lines">{item.highlights.map((line, index) => <li key={`${line}-${index}`}><Check size={12} />{line}</li>)}</ul> : null}</div>
                <button type="button" disabled={savingHighlights || highlights.featured.length >= 5} onClick={() => void toggleHighlight(item, true)} aria-label={t("agent.highlights.select")}><Plus size={15} /></button>
              </li>
            ))}</ul>}
          </section>
        </div>
      </section>

      <AgentPublicationControls
        initialOverview={initialPublicationOverview}
        locale={locale}
        publicMode={settings.publicMode}
        onPublicModeChange={(publicMode) => setSettings((current) => current.publicMode === publicMode ? current : { ...current, publicMode })}
      />
      <footer className="candidate-footer"><span>{t("shared.footerRights")}</span><span>{t("shared.footerLinks")}</span></footer>
      {pendingReset ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !resetting) setPendingReset(false); }}><section ref={resetDialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="agent-reset-title" aria-describedby="agent-reset-description" tabIndex={-1}><span className="confirm-icon"><RotateCcw size={25} /></span><h2 id="agent-reset-title">{t("agent.reset.title")}</h2><p id="agent-reset-description">{t("agent.reset.copy")}</p><div><button className="secondary-button" type="button" data-autofocus disabled={resetting} onClick={() => setPendingReset(false)}>{t("agent.reset.cancel")}</button><button className="danger-button" type="button" disabled={resetting} onClick={() => void resetPreview()}>{resetting ? <LoaderCircle className="spin" size={17} /> : <RotateCcw size={17} />} {t("agent.reset.confirm")}</button></div></section></div> : null}
    </div>
  );
}
