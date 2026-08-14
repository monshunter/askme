"use client";

import { AlertCircle, Bot, BookOpen, Check, Clock3, FileText, Globe2, LoaderCircle, MapPin, MessageSquarePlus, MessageSquareText, MessagesSquare, RefreshCw, Send, Share2, ShieldCheck, Sparkles, ThumbsDown, ThumbsUp, Trash2, UserRound, X } from "lucide-react";
import Link from "next/link";
import { FormEvent, useCallback, useEffect, useMemo, useRef, useState } from "react";

import { ApiClientError, requestApi } from "@/components/candidate/api-client";
import { MarkdownContent } from "@/components/markdown-content";
import { SourceLink, type SourceOpenMode } from "@/components/source-viewer";
import { useModalFocus } from "@/components/use-modal-focus";
import { createTranslator, type Locale } from "@/i18n/core";
import { PUBLIC_VISITOR_HEADER, PUBLIC_VISITOR_STORAGE_KEY } from "@/shared/public-visitor";

type Citation = { materialTitle: string; access: { href: string; mode: SourceOpenMode } | null };
type PublicMessage = { id: string; role: "user" | "assistant"; status: "pending" | "completed" | "failed"; content: string; errorCode: string | null; createdAt: string; feedback: "up" | "down" | null; citations: Citation[]; analysisRun: { id: string; version: number; state: "pending" | "running" | "completed" | "failed" | "cancelled"; phase: string } | null };
type Thread = { conversation: { id: string; expiresAt: string }; messages: PublicMessage[]; suggestedQuestions: string[]; idempotent?: boolean; pending?: boolean };
type PublicSession = { id: string; title: string | null; messageCount: number; createdAt: string; lastActivityAt: string; expiresAt: string };
type PublicProjection = {
  profile: { displayName: string; headline: string; location: string | null; bio: string | null; avatarUrl: string | null };
  agent: { slug: string; status: "published"; publishedAt: string; updatedAt: string };
  stats: { publicKnowledgeItems: number; publicSources: number };
  highlights: Array<{ id: string; type: string; title: string; summary: string; highlights: string[] }>;
  suggestedQuestions: string[];
};
type Envelope<T> = { data?: T; error?: { code?: string; message?: string; details?: { retryAfterSeconds?: number } } | null };

function visitorRequest(visitorToken: string, init: RequestInit = {}) {
  return { ...init, headers: { ...(init.headers as Record<string, string> | undefined), [PUBLIC_VISITOR_HEADER]: visitorToken } };
}

function connectionFeedback(error: unknown, action: string, locale: Locale) {
  const t = createTranslator(locale);
  return error instanceof ApiClientError && error.kind === "invalid_response" ? t("public.connectionInvalid", { action }) : t("public.connectionFailed", { action });
}

function answerLabel(code: string, locale: Locale) {
  const t = createTranslator(locale);
  if (code === "INSUFFICIENT_EVIDENCE") return t("public.outcome.moreEvidence");
  if (code === "QUESTION_INJECTION" || code === "QUESTION_DATA_EXFILTRATION") return t("public.outcome.refused");
  if (code === "QUESTION_OUT_OF_SCOPE") return t("public.outcome.scope");
  if (code === "SOURCE_PERMISSION_CHANGED") return t("public.outcome.permission");
  return t("public.outcome.failed");
}

export function PublicAgentClient({ slug, initialProjection, locale }: { slug: string; initialProjection: PublicProjection; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [thread, setThread] = useState<Thread | null>(null);
  const [sessions, setSessions] = useState<PublicSession[]>([]);
  const [suggestions, setSuggestions] = useState(initialProjection.suggestedQuestions);
  const [question, setQuestion] = useState("");
  const [sessionState, setSessionState] = useState<"starting" | "ready" | "failed">("starting");
  const [sending, setSending] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [feedbackSaving, setFeedbackSaving] = useState<string | null>(null);
  const [sessionAction, setSessionAction] = useState<"create" | "switch" | "delete" | null>(null);
  const [pendingDelete, setPendingDelete] = useState<PublicSession | null>(null);
  const [agentUnavailable, setAgentUnavailable] = useState(false);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const initialized = useRef(false);
  const visitorToken = useRef<string | null>(null);
  const threadEnd = useRef<HTMLDivElement>(null);
  const runEvents = useRef(new Map<string, EventSource>());
  const deleteDialogRef = useModalFocus(Boolean(pendingDelete), () => setPendingDelete(null), sessionAction === "delete");

  const closeRunEvents = useCallback(() => {
    for (const source of runEvents.current.values()) source.close();
    runEvents.current.clear();
  }, []);

  const loadSessions = useCallback(async () => {
    if (!visitorToken.current) throw new Error(t("public.sessionFailed"));
    const { response, payload } = await requestApi<Envelope<{ sessions: PublicSession[] }>>(`/api/public/agents/${slug}/sessions`, visitorRequest(visitorToken.current, { cache: "no-store" }));
    if (!response.ok) throw new Error(t("public.sessions.loadFailed"));
    if (!payload.data) throw new ApiClientError("invalid_response");
    setSessions(payload.data.sessions);
    return payload.data.sessions;
  }, [slug, t]);

  const loadThread = useCallback(async (conversationId: string) => {
    if (!visitorToken.current) throw new Error(t("public.sessionFailed"));
    const { response, payload } = await requestApi<Envelope<Thread>>(`/api/public/agents/${slug}/chat?conversationId=${encodeURIComponent(conversationId)}`, visitorRequest(visitorToken.current, { cache: "no-store" }));
    if (payload.error?.code === "PUBLIC_AGENT_UNAVAILABLE") {
      setAgentUnavailable(true);
      return null;
    }
    if (!response.ok) throw new Error(t("public.threadLoadFailed"));
    if (!payload.data) throw new ApiClientError("invalid_response");
    setThread(payload.data);
    setSuggestions(payload.data.suggestedQuestions);
    return payload.data;
  }, [slug, t]);

  const watchAnalysisRun = useCallback((runId: string, conversationId: string) => {
    if (runEvents.current.has(runId)) return;
    const source = new EventSource(`/api/public/agents/${slug}/analysis-runs/${runId}/events?conversationId=${encodeURIComponent(conversationId)}`);
    runEvents.current.set(runId, source);
    const settle = () => {
      source.close();
      runEvents.current.delete(runId);
      void Promise.all([loadThread(conversationId), loadSessions()]).catch(() => setNotice({ tone: "error", message: t("public.threadLoadFailed") }));
    };
    source.addEventListener("run", (event) => {
      try {
        const snapshot = JSON.parse((event as MessageEvent<string>).data) as { completed?: unknown };
        if (snapshot.completed === true) settle();
      } catch { settle(); }
    });
    source.addEventListener("invalidated", settle);
  }, [loadSessions, loadThread, slug, t]);

  useEffect(() => {
    const conversationId = thread?.conversation.id;
    if (!conversationId) return;
    for (const message of thread?.messages ?? []) {
      if (message.status === "pending" && !message.errorCode && message.analysisRun && (message.analysisRun.state === "pending" || message.analysisRun.state === "running")) {
        watchAnalysisRun(message.analysisRun.id, conversationId);
      }
    }
  }, [thread, watchAnalysisRun]);

  useEffect(() => closeRunEvents, [closeRunEvents]);

  async function initializeSession() {
    setSessionState("starting");
    const storedToken = localStorage.getItem(PUBLIC_VISITOR_STORAGE_KEY);
    const { response, payload } = await requestApi<Envelope<{ conversationId: string; visitorToken: string }>>(
      `/api/public/agents/${slug}/session`,
      storedToken ? visitorRequest(storedToken, { method: "POST" }) : { method: "POST" },
    );
    if (!response.ok) {
      if (payload.error?.code === "PUBLIC_AGENT_UNAVAILABLE") setAgentUnavailable(true);
      setSessionState("failed");
      setNotice({ tone: "error", message: t("public.sessionFailed") });
      return null;
    }
    if (!payload.data || !/^[A-Za-z0-9_-]{43}$/.test(payload.data.visitorToken)) throw new ApiClientError("invalid_response");
    localStorage.setItem(PUBLIC_VISITOR_STORAGE_KEY, payload.data.visitorToken);
    visitorToken.current = payload.data.visitorToken;
    await Promise.all([loadThread(payload.data.conversationId), loadSessions()]);
    setSessionState("ready");
    return payload.data.conversationId;
  }

  async function createSessionRequest() {
    if (!visitorToken.current) throw new Error(t("public.sessionFailed"));
    const { response, payload } = await requestApi<Envelope<{ conversation: { id: string } }>>(
      `/api/public/agents/${slug}/sessions`,
      visitorRequest(visitorToken.current, { method: "POST" }),
    );
    if (!response.ok) throw new Error(t("public.sessions.createFailed"));
    if (!payload.data?.conversation.id) throw new ApiClientError("invalid_response");
    return payload.data.conversation.id;
  }

  async function selectSession(conversationId: string) {
    if (conversationId === thread?.conversation.id || sessionAction || sending) return;
    setSessionAction("switch");
    setSessionState("starting");
    setNotice(null);
    closeRunEvents();
    try {
      const loaded = await loadThread(conversationId);
      if (!loaded) return;
      await loadSessions();
      setSessionState("ready");
    } catch (error) {
      setSessionState(thread ? "ready" : "failed");
      setNotice({ tone: "error", message: connectionFeedback(error, t("public.action.sessions"), locale) });
    } finally {
      setSessionAction(null);
    }
  }

  async function createConversation() {
    if (sessionAction || sending) return;
    setSessionAction("create");
    setSessionState("starting");
    setNotice(null);
    try {
      const conversationId = await createSessionRequest();
      closeRunEvents();
      await Promise.all([loadThread(conversationId), loadSessions()]);
      setSessionState("ready");
    } catch (error) {
      setSessionState(thread ? "ready" : "failed");
      setNotice({ tone: "error", message: connectionFeedback(error, t("public.action.sessions"), locale) });
    } finally {
      setSessionAction(null);
    }
  }

  async function deleteConversation(session: PublicSession) {
    if (!visitorToken.current || sessionAction || sending) return;
    let deletedCurrent = false;
    setSessionAction("delete");
    setNotice(null);
    try {
      const { response, payload } = await requestApi<Envelope<{ id: string; deleted: true }>>(
        `/api/public/agents/${slug}/sessions/${encodeURIComponent(session.id)}`,
        visitorRequest(visitorToken.current, { method: "DELETE" }),
      );
      if (!response.ok) {
        setNotice({ tone: "error", message: payload.error?.code === "PUBLIC_SESSION_BUSY" ? t("public.sessions.busy") : t("public.sessions.deleteFailed") });
        return;
      }
      setPendingDelete(null);
      deletedCurrent = thread?.conversation.id === session.id;
      if (deletedCurrent) {
        closeRunEvents();
        setSessionState("starting");
        setThread(null);
      }
      const remaining = await loadSessions();
      if (!deletedCurrent) return;
      const nextConversationId = remaining[0]?.id ?? await createSessionRequest();
      await Promise.all([loadThread(nextConversationId), remaining.length > 0 ? Promise.resolve(remaining) : loadSessions()]);
      setSessionState("ready");
    } catch (error) {
      setSessionState(deletedCurrent ? "failed" : thread ? "ready" : "failed");
      setNotice({ tone: "error", message: connectionFeedback(error, t("public.action.sessions"), locale) });
    } finally {
      setPendingDelete(null);
      setSessionAction(null);
    }
  }

  useEffect(() => {
    if (initialized.current) return;
    initialized.current = true;
    void initializeSession().catch((error) => {
      setSessionState("failed");
      setNotice({ tone: "error", message: connectionFeedback(error, t("public.action.session"), locale) });
    });
    // The session initializer is intentionally bound to this immutable public slug.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [slug]);

  useEffect(() => {
    threadEnd.current?.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, [thread?.messages.length]);

  async function sendQuestion(value: string) {
    const normalized = value.trim();
    const initialConversationId = thread?.conversation.id;
    if (!normalized || sending || !initialConversationId) return;
    setSending(true);
    setNotice(null);
    setRetryQuestion(null);
    const clientMessageId = crypto.randomUUID();
    try {
      const perform = (conversationId: string) => requestApi<Envelope<Thread>>(`/api/public/agents/${slug}/chat`, {
        ...visitorRequest(visitorToken.current ?? ""),
        method: "POST",
        headers: { ...visitorRequest(visitorToken.current ?? "").headers, "content-type": "application/json" },
        body: JSON.stringify({ clientMessageId, conversationId, question: normalized }),
      });
      let activeConversationId = initialConversationId;
      let result = await perform(activeConversationId);
      if ((result.response.status === 401 || result.response.status === 404)) {
        const restoredConversationId = await initializeSession();
        if (restoredConversationId) {
          activeConversationId = restoredConversationId;
          result = await perform(activeConversationId);
        }
      }
      if (!result.response.ok) {
        if (result.payload.error?.code === "PUBLIC_AGENT_UNAVAILABLE") setAgentUnavailable(true);
        await loadThread(activeConversationId).catch(() => undefined);
        setRetryQuestion(normalized);
        const wait = result.payload.error?.details?.retryAfterSeconds;
        setNotice({ tone: "error", message: wait ? t("public.rateLimited", { seconds: wait }) : t("public.answerFailed") });
        return;
      }
      if (!result.payload.data) throw new ApiClientError("invalid_response");
      setThread(result.payload.data);
      setSuggestions(result.payload.data.suggestedQuestions);
      setQuestion("");
      void loadSessions().catch(() => setNotice({ tone: "error", message: t("public.sessions.loadFailed") }));
    } catch (error) {
      setRetryQuestion(normalized);
      setNotice({ tone: "error", message: connectionFeedback(error, t("public.action.answer"), locale) });
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(question);
  }

  async function refreshSuggestions() {
    setRefreshing(true);
    setNotice(null);
    try {
      if (!visitorToken.current || !thread) throw new Error(t("public.sessionFailed"));
      const { response, payload } = await requestApi<Envelope<{ suggestedQuestions: string[] }>>(`/api/public/agents/${slug}/suggestions/refresh`, visitorRequest(visitorToken.current, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ conversationId: thread.conversation.id }),
      }));
      if (!response.ok) {
        if (payload.error?.code === "PUBLIC_AGENT_UNAVAILABLE") setAgentUnavailable(true);
        setNotice({ tone: "error", message: t("public.suggestionsFailed") });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setSuggestions(payload.data.suggestedQuestions);
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t("public.action.suggestions"), locale) });
    } finally {
      setRefreshing(false);
    }
  }

  async function saveFeedback(message: PublicMessage, value: "up" | "down") {
    setFeedbackSaving(message.id);
    try {
      if (!visitorToken.current || !thread) throw new Error(t("public.sessionFailed"));
      const { response, payload } = await requestApi<Envelope<{ value: "up" | "down" }>>(`/api/public/agents/${slug}/messages/${message.id}/feedback?conversationId=${encodeURIComponent(thread.conversation.id)}`, {
        ...visitorRequest(visitorToken.current),
        method: "PUT",
        headers: { ...visitorRequest(visitorToken.current).headers, "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) {
        if (payload.error?.code === "PUBLIC_AGENT_UNAVAILABLE") setAgentUnavailable(true);
        setNotice({ tone: "error", message: t("public.feedbackFailed") });
        return;
      }
      setThread((current) => current ? { ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, feedback: value } : item) } : current);
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t("public.action.feedback"), locale) });
    } finally {
      setFeedbackSaving(null);
    }
  }

  async function shareLink() {
    try {
      await navigator.clipboard.writeText(window.location.href);
      setNotice({ tone: "success", message: t("public.share.copied") });
    } catch {
      setNotice({ tone: "error", message: t("public.share.copyBlocked") });
    }
  }

  const initials = initialProjection.profile.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2).toUpperCase();
  if (agentUnavailable) {
    return <main className="public-unavailable"><Link className="public-wordmark" href="/">Askme <span aria-hidden="true">职问</span></Link><section><span><AlertCircle size={34} /></span><h1>{t("public.unavailable.title")}</h1><p>{t("public.unavailable.changed")}</p><Link href="/">{t("public.return")}</Link></section></main>;
  }
  return (
    <div className="public-agent-page">
      <a className="skip-link" href="#public-main">{t("shared.skip")}</a>
      <header className="public-agent-topbar"><Link className="public-wordmark" href="/">Askme <span aria-hidden="true">职问</span></Link><div className="public-trust"><ShieldCheck size={20} /><span><strong>{t("public.trust.title")}</strong><small>{t("public.trust.copy")}</small></span></div></header>
      <div className="public-agent-layout">
        <aside className="public-candidate-sidebar">
          <section className="public-candidate-card">
            <span className="public-candidate-avatar">
              {/* Candidate avatar URLs are user data and may not belong to a preconfigured Next image host. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              {initialProjection.profile.avatarUrl ? <img src={initialProjection.profile.avatarUrl} alt="" /> : initials}
            </span>
            <h1>{initialProjection.profile.displayName}</h1><span className="public-agent-label"><Globe2 size={13} /> {t("public.badge")}</span><h2>{initialProjection.profile.headline}</h2>{initialProjection.profile.location ? <p className="public-location"><MapPin size={13} /> {initialProjection.profile.location}</p> : null}<p className="public-candidate-bio">{initialProjection.profile.bio ?? t("public.bioFallback")}</p>
            <div className="public-candidate-facts"><span><i className="ready" /> {t("public.facts.status")} <strong>{t("status.ready")}</strong></span><span><Clock3 size={15} /> {t("public.facts.updated")} <strong>{new Date(initialProjection.agent.updatedAt).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" })}</strong></span><span><BookOpen size={15} /> {t("public.facts.knowledge")} <strong>{initialProjection.stats.publicKnowledgeItems}</strong></span><span><FileText size={15} /> {t("public.facts.sources")} <strong>{initialProjection.stats.publicSources}</strong></span></div>
          </section>
          <section className="public-session-panel" aria-labelledby="public-session-list-title">
            <header><span><MessagesSquare size={18} /><strong id="public-session-list-title">{t("public.sessions.title")}</strong></span><button type="button" disabled={Boolean(sessionAction) || sending || sessionState !== "ready"} onClick={() => void createConversation()} aria-label={t("public.sessions.newLabel")}>{sessionAction === "create" ? <LoaderCircle className="spin" size={17} /> : <MessageSquarePlus size={17} />}<span>{t("public.sessions.new")}</span></button></header>
            <nav aria-label={t("public.sessions.title")}>
              {sessions.length === 0 ? <p>{sessionState === "starting" ? t("public.sessions.loading") : t("public.sessions.empty")}</p> : sessions.map((session) => {
                const selected = session.id === thread?.conversation.id;
                const title = session.title ?? t("public.sessions.untitled");
                return <article className={selected ? "active" : ""} key={session.id}>
                  <button className="public-session-select" type="button" disabled={Boolean(sessionAction) || sending} onClick={() => void selectSession(session.id)} aria-current={selected ? "page" : undefined}>
                    {sessionAction === "switch" && !selected ? <LoaderCircle className="spin" size={16} /> : <MessageSquareText size={16} />}
                    <span><strong>{title}</strong><small>{new Date(session.lastActivityAt).toLocaleDateString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" })} · {t("public.sessions.messages", { count: session.messageCount })}</small></span>
                  </button>
                  <button className="public-session-delete" type="button" disabled={Boolean(sessionAction) || sending} onClick={() => setPendingDelete(session)} aria-label={t("public.sessions.deleteLabel", { title })}><Trash2 size={15} /></button>
                </article>;
              })}
            </nav>
          </section>
          <button className="share-agent-link" type="button" onClick={() => void shareLink()}><Share2 size={19} /><span><strong>{t("public.share.title")}</strong><small>{t("public.share.copy")}</small></span></button>
        </aside>

        <main className="public-agent-main" id="public-main" tabIndex={-1}>
          <section className="public-agent-hero"><p className="page-kicker">{t("public.hero.kicker")}</p><h1>{t("public.hero.title")} <span className="title-seal" aria-hidden="true">职问</span></h1><p>{t("public.hero.copy", { name: initialProjection.profile.displayName })}</p></section>
          {notice ? <div className={`inline-feedback ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.tone === "error" ? <AlertCircle size={18} /> : notice.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{notice.message}{retryQuestion ? <button className="inline-retry" type="button" disabled={sending} onClick={() => void sendQuestion(retryQuestion)}><RefreshCw size={15} /> {t("public.retry")}</button> : null}<button type="button" onClick={() => setNotice(null)} aria-label={t("shared.dismiss")}><X size={16} /></button></div> : null}

          <div className="public-chat-shell">
            <section className="public-chat-column" aria-label={t("public.conversation")}>
              <div className="public-chat-thread" aria-live="polite">
                {sessionState === "starting" && !thread ? <div className="empty-state public-chat-empty"><LoaderCircle className="spin" size={26} /><h2>{t("public.session.starting")}</h2></div> : sessionState === "failed" && !thread ? <div className="empty-state public-chat-empty"><AlertCircle size={28} /><h2>{t("public.session.unavailable")}</h2><button className="secondary-button" type="button" onClick={() => void initializeSession()}>{t("public.session.tryAgain")}</button></div> : thread?.messages.length ? thread.messages.map((message) => message.role === "user" ? <article className="public-message public-user-message" key={message.id}><span><UserRound size={20} /></span><div><MarkdownContent content={message.content} /></div></article> : <article className={`public-message public-assistant-message ${message.status}`} key={message.id}><span><Bot size={20} /></span><div>{message.status === "pending" ? <p>{t("public.answer.grounding")}</p> : <MarkdownContent content={message.content} />}{message.errorCode ? <small className={`answer-outcome ${message.status}`}>{answerLabel(message.errorCode, locale)}</small> : null}{message.citations.length > 0 ? <section className="public-answer-sources"><h3>{t("public.answer.sources")}</h3>{message.citations.map((citation, index) => <article key={`${citation.materialTitle}-${index}`}><FileText size={16} /><SourceLink title={citation.materialTitle} href={citation.access?.href ?? null} mode={citation.access?.mode ?? "new_tab"} locale={locale} /></article>)}</section> : null}<footer><span>{message.citations.length > 0 ? t("public.answer.citations", { count: message.citations.length }) : ""}</span>{message.status === "completed" ? <span><button className={message.feedback === "up" ? "active" : ""} type="button" disabled={feedbackSaving === message.id} onClick={() => void saveFeedback(message, "up")} aria-label={t("agent.helpful")}><ThumbsUp size={15} /></button><button className={message.feedback === "down" ? "active" : ""} type="button" disabled={feedbackSaving === message.id} onClick={() => void saveFeedback(message, "down")} aria-label={t("agent.unhelpful")}><ThumbsDown size={15} /></button></span> : null}</footer></div></article>) : <div className="empty-state public-chat-empty"><Bot size={30} /><h2>{t("public.empty.title")}</h2><p>{t("public.empty.copy")}</p></div>}
                <div ref={threadEnd} />
              </div>
              <form className="public-chat-composer" onSubmit={submit}><label className="sr-only" htmlFor="public-agent-question">{t("public.question.label")}</label><textarea id="public-agent-question" value={question} maxLength={500} rows={2} disabled={sending || sessionState !== "ready"} onChange={(event) => setQuestion(event.target.value)} placeholder={t("public.question.placeholder", { name: initialProjection.profile.displayName })} /><button type="submit" disabled={sending || sessionState !== "ready" || !question.trim()} aria-label={t("public.question.send")}>{sending ? <LoaderCircle className="spin" size={20} /> : <Send size={20} />}</button></form>
              <div className="public-suggestions"><div>{suggestions.map((suggestion) => <button type="button" key={suggestion} disabled={sending || sessionState !== "ready"} onClick={() => void sendQuestion(suggestion)}><MessageSquareText size={14} /> {suggestion}</button>)}<button className="refresh-public-suggestions" type="button" disabled={refreshing || sessionState !== "ready"} onClick={() => void refreshSuggestions()} aria-label={t("public.question.refresh")}>{refreshing ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />}</button></div></div>
            </section>

            <aside className="public-highlights-column"><section><h2>{t("public.highlights.title")}</h2>{initialProjection.highlights.length === 0 ? <p>{t("public.highlights.empty")}</p> : initialProjection.highlights.map((highlight) => <article key={highlight.id}><span><Sparkles size={17} /></span><div><strong>{highlight.title}</strong><p>{highlight.summary}</p></div></article>)}</section><section className="public-learn-more"><h2>{t("public.learn.title")}</h2><p>{t("public.learn.copy")}</p></section></aside>
          </div>
        </main>
      </div>
      <footer className="public-footer"><span>{t("shared.footerRights")}</span><span>{t("shared.footerLinks")}</span></footer>
      {pendingDelete ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && sessionAction !== "delete") setPendingDelete(null); }}><section ref={deleteDialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="public-delete-title" aria-describedby="public-delete-description" tabIndex={-1}><span className="confirm-icon"><Trash2 size={25} /></span><h2 id="public-delete-title">{t("public.sessions.deleteTitle")}</h2><p id="public-delete-description">{t("public.sessions.deleteCopy", { title: pendingDelete.title ?? t("public.sessions.untitled") })}</p><div><button className="secondary-button" type="button" data-autofocus disabled={sessionAction === "delete"} onClick={() => setPendingDelete(null)}>{t("public.sessions.cancel")}</button><button className="danger-button" type="button" disabled={sessionAction === "delete"} onClick={() => void deleteConversation(pendingDelete)}>{sessionAction === "delete" ? <LoaderCircle className="spin" size={17} /> : <Trash2 size={17} />} {t("public.sessions.confirmDelete")}</button></div></section></div> : null}
    </div>
  );
}
