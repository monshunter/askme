"use client";

import {
  AlertCircle,
  Bot,
  Check,
  ChevronRight,
  CircleUserRound,
  FileText,
  Globe2,
  Link2,
  LoaderCircle,
  MessageSquareText,
  RefreshCw,
  Send,
  ShieldCheck,
  Sparkles,
  ThumbsDown,
  ThumbsUp,
  X,
} from "lucide-react";
import Link from "next/link";
import { FormEvent, useMemo, useState } from "react";

import { ApiClientError, requestApi } from "./api-client";

type Visibility = "private" | "agent_only" | "citation_allowed" | "public_preview";
type Citation = {
  chunkId: string;
  rank: number;
  excerpt: string;
  materialId: string;
  materialTitle: string;
  materialKind: "file" | "github" | "notion" | "website";
  externalUrl: string | null;
  visibility: Visibility;
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
};
type PreviewThread = {
  conversation: { id: string; createdAt: string; lastActivityAt: string } | null;
  messages: AgentMessage[];
  idempotent?: boolean;
  pending?: boolean;
};
type AgentSettings = {
  answerTone: "professional" | "concise" | "conversational";
  publicMode: boolean;
  privacySafeMode: boolean;
  suggestedQuestions: string[];
  updatedAt: string;
};
type ApiEnvelope<T> = { data?: T; error?: { code?: string; message?: string } | null };

function connectionFeedback(error: unknown, action: string) {
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? `The ${action} returned an invalid response.`
    : `The ${action} connection failed. Try again.`;
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat("en", { hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function visibilityLabel(visibility: Visibility) {
  if (visibility === "agent_only") return "Agent-only · not public";
  if (visibility === "public_preview") return "Public preview";
  if (visibility === "citation_allowed") return "Citation allowed";
  return "Private";
}

export function AgentPreviewClient({ initialThread, initialSettings }: { initialThread: PreviewThread; initialSettings: AgentSettings }) {
  const [thread, setThread] = useState(initialThread);
  const [settings, setSettings] = useState(initialSettings);
  const [question, setQuestion] = useState("");
  const [sending, setSending] = useState(false);
  const [refreshingSuggestions, setRefreshingSuggestions] = useState(false);
  const [savingSetting, setSavingSetting] = useState<keyof Pick<AgentSettings, "answerTone" | "publicMode" | "privacySafeMode"> | null>(null);
  const [feedbackSaving, setFeedbackSaving] = useState<string | null>(null);
  const [selectedAnswerId, setSelectedAnswerId] = useState<string | null>(null);
  const [retryQuestion, setRetryQuestion] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);

  const assistantMessages = useMemo(() => thread.messages.filter((message) => message.role === "assistant"), [thread.messages]);
  const activeAnswer = useMemo(
    () => assistantMessages.find((message) => message.id === selectedAnswerId) ?? [...assistantMessages].reverse().find((message) => message.citations.length > 0) ?? assistantMessages.at(-1) ?? null,
    [assistantMessages, selectedAnswerId],
  );

  async function refreshThread() {
    const { response, payload } = await requestApi<ApiEnvelope<PreviewThread>>("/api/agent/preview", { cache: "no-store" });
    if (!response.ok) throw new Error(payload.error?.message ?? "The conversation could not be refreshed.");
    if (!payload.data) throw new ApiClientError("invalid_response");
    setThread(payload.data);
    return payload.data;
  }

  async function sendQuestion(value: string) {
    const normalized = value.replace(/\s+/g, " ").trim();
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
        setNotice({ tone: "error", message: payload.error?.message ?? "The Agent could not answer. Retry when the service is available." });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setThread(payload.data);
      const newestAnswer = [...payload.data.messages].reverse().find((message) => message.role === "assistant");
      setSelectedAnswerId(newestAnswer?.id ?? null);
      setQuestion("");
    } catch (error) {
      setRetryQuestion(normalized);
      setNotice({ tone: "error", message: connectionFeedback(error, "Agent answer") });
    } finally {
      setSending(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    void sendQuestion(question);
  }

  async function updateSetting<Key extends "answerTone" | "publicMode" | "privacySafeMode">(key: Key, value: AgentSettings[Key]) {
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
        setNotice({ tone: "error", message: payload.error?.message ?? "The Agent setting could not be saved." });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setSettings(payload.data);
      setNotice({ tone: "success", message: "Agent settings saved. New answers will use this configuration." });
    } catch (error) {
      setSettings(previous);
      setNotice({ tone: "error", message: connectionFeedback(error, "settings update") });
    } finally {
      setSavingSetting(null);
    }
  }

  async function refreshSuggestions() {
    setRefreshingSuggestions(true);
    setNotice(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<AgentSettings>>("/api/agent/settings/suggestions/refresh", { method: "POST" });
      if (!response.ok) {
        setNotice({ tone: "error", message: payload.error?.message ?? "Suggested questions could not be refreshed." });
        return;
      }
      if (!payload.data) throw new ApiClientError("invalid_response");
      setSettings(payload.data);
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, "question refresh") });
    } finally {
      setRefreshingSuggestions(false);
    }
  }

  async function saveFeedback(message: AgentMessage, value: "up" | "down") {
    setFeedbackSaving(message.id);
    setNotice(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<{ value: "up" | "down" }>>(`/api/agent/messages/${message.id}/feedback`, {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ value }),
      });
      if (!response.ok) {
        setNotice({ tone: "error", message: payload.error?.message ?? "Feedback could not be saved." });
        return;
      }
      setThread((current) => ({ ...current, messages: current.messages.map((item) => item.id === message.id ? { ...item, feedback: value } : item) }));
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, "feedback") });
    } finally {
      setFeedbackSaving(null);
    }
  }

  return (
    <div className="candidate-page agent-preview-page">
      <section className="page-hero compact-hero agent-hero">
        <p className="page-kicker">Candidate Agent</p>
        <h1>Agent Preview <span className="title-seal" aria-hidden="true">问候</span></h1>
        <p>Test how your career Agent answers interviewer questions before publishing.</p>
        <span className="agent-evidence-note"><ShieldCheck size={18} /> Answers are grounded in your authorized evidence.</span>
      </section>

      {notice ? <div className={`inline-feedback ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.tone === "error" ? <AlertCircle size={18} /> : notice.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{notice.message}{retryQuestion ? <button className="inline-retry" type="button" disabled={sending} onClick={() => void sendQuestion(retryQuestion)}><RefreshCw size={15} /> Retry</button> : null}<button type="button" onClick={() => setNotice(null)} aria-label="Dismiss"><X size={16} /></button></div> : null}

      <div className="agent-preview-grid">
        <section className="paper-card agent-chat-card" aria-label="Candidate Agent preview conversation">
          <div className="agent-thread" aria-live="polite">
            {thread.messages.length === 0 ? (
              <div className="empty-state agent-empty"><span><Bot size={28} /></span><h2>Ask your Agent a question</h2><p>Try a suggested question or ask about your projects, experience, skills, and evidence.</p></div>
            ) : thread.messages.map((message) => message.role === "user" ? (
              <article className="chat-message user-message" key={message.id}>
                <span className="chat-avatar user"><CircleUserRound size={24} /></span>
                <div><p>{message.content}</p><time dateTime={message.createdAt}>{timeLabel(message.createdAt)}</time></div>
              </article>
            ) : (
              <article className={`chat-message assistant-message ${message.status}`} key={message.id} onClick={() => setSelectedAnswerId(message.id)}>
                <span className="chat-avatar agent"><Bot size={22} /></span>
                <div className="assistant-bubble">
                  {message.status === "pending" ? <p className="answer-status"><LoaderCircle className="spin" size={16} /> Agent is grounding the answer…</p> : <p>{message.content}</p>}
                  {message.errorCode ? <span className={`answer-outcome ${message.status}`}>{message.errorCode === "INSUFFICIENT_EVIDENCE" ? "More evidence needed" : message.errorCode === "REFUSED" ? "Safely refused" : "Answer failed"}</span> : null}
                  <footer>
                    <span>{message.citations.length > 0 ? `${message.citations.length} cited source${message.citations.length === 1 ? "" : "s"}` : message.status === "completed" ? "No source exposed" : ""}</span>
                    {message.status === "completed" ? <span className="answer-feedback" aria-label="Rate this answer"><button className={message.feedback === "up" ? "active" : ""} type="button" disabled={feedbackSaving === message.id} onClick={(event) => { event.stopPropagation(); void saveFeedback(message, "up"); }} aria-label="Helpful answer"><ThumbsUp size={15} /></button><button className={message.feedback === "down" ? "active" : ""} type="button" disabled={feedbackSaving === message.id} onClick={(event) => { event.stopPropagation(); void saveFeedback(message, "down"); }} aria-label="Unhelpful answer"><ThumbsDown size={15} /></button></span> : null}
                  </footer>
                </div>
              </article>
            ))}
          </div>

          <form className="agent-composer" onSubmit={submit}>
            <label htmlFor="agent-question">Ask about your career evidence</label>
            <div><textarea id="agent-question" value={question} maxLength={500} rows={2} disabled={sending} onChange={(event) => setQuestion(event.target.value)} placeholder="Ask about a project, skill, or measurable impact…" /><button type="submit" disabled={sending || !question.trim()} aria-label="Send question">{sending ? <LoaderCircle className="spin" size={19} /> : <Send size={19} />}</button></div>
            <small>{question.length}/500 · Only authorized sources enter the answer context.</small>
          </form>

          <section className="suggestion-section" aria-labelledby="suggestion-title">
            <div><h2 id="suggestion-title">Try asking something else</h2><button type="button" disabled={refreshingSuggestions} onClick={() => void refreshSuggestions()}>{refreshingSuggestions ? <LoaderCircle className="spin" size={15} /> : <RefreshCw size={15} />} Refresh</button></div>
            <div className="suggestion-grid">{settings.suggestedQuestions.map((suggestion) => <button type="button" key={suggestion} disabled={sending} onClick={() => void sendQuestion(suggestion)}><MessageSquareText size={16} />{suggestion}</button>)}</div>
          </section>
        </section>

        <aside className="paper-card citations-card" aria-label="Citations and sources">
          <header><span><h2>Citations &amp; Sources</h2><small>{activeAnswer ? "Sources used in the selected answer" : "Select a grounded answer"}</small></span><strong>{activeAnswer?.citations.length ?? 0} sources</strong></header>
          {!activeAnswer || activeAnswer.citations.length === 0 ? <div className="empty-state citations-empty"><FileText size={26} /><p>No citations to show for this answer.</p><small>Grounded answers expose only the sources they actually use.</small></div> : (
            <ol className="citation-list">{activeAnswer.citations.map((citation) => <li key={citation.chunkId}><span className="citation-rank">{citation.rank}</span><span className="citation-file"><FileText size={19} /></span><div><strong>{citation.materialTitle}</strong><small>{citation.materialKind.toUpperCase()} · {visibilityLabel(citation.visibility)}</small><p>{citation.excerpt}</p>{citation.externalUrl ? <a href={citation.externalUrl} target="_blank" rel="noreferrer"><Link2 size={13} /> Open original link</a> : null}</div></li>)}</ol>
          )}
          <Link className="knowledge-deep-link" href="/workspace/knowledge"><FileText size={17} /> View all in Knowledge Base <ChevronRight size={17} /></Link>
        </aside>
      </div>

      <section className="agent-settings-grid" aria-label="Agent settings">
        <label className="paper-card agent-setting"><span className="setting-icon"><Sparkles size={19} /></span><span><strong>Answer Tone</strong><small>Controls the style of new answers.</small></span><select value={settings.answerTone} disabled={savingSetting === "answerTone"} onChange={(event) => void updateSetting("answerTone", event.target.value as AgentSettings["answerTone"])}><option value="professional">Professional</option><option value="concise">Concise</option><option value="conversational">Conversational</option></select></label>
        <label className="paper-card agent-setting"><span className="setting-icon"><Globe2 size={19} /></span><span><strong>Public Mode</strong><small>Stores your intent to answer interviewers.</small></span><select value={settings.publicMode ? "on" : "off"} disabled={savingSetting === "publicMode"} onChange={(event) => void updateSetting("publicMode", event.target.value === "on")}><option value="on">On</option><option value="off">Off</option></select></label>
        <label className="paper-card agent-setting"><span className="setting-icon"><ShieldCheck size={19} /></span><span><strong>Privacy-Safe Mode</strong><small>Omits unnecessary sensitive detail.</small></span><select value={settings.privacySafeMode ? "on" : "off"} disabled={savingSetting === "privacySafeMode"} onChange={(event) => void updateSetting("privacySafeMode", event.target.value === "on")}><option value="on">On</option><option value="off">Off</option></select></label>
      </section>

      <section className="paper-card preview-publish-card"><span className="publish-icon"><Globe2 size={26} /></span><span><h2>Publish Your Agent</h2><p>Review readiness, generate a share link, and control interviewer access.</p></span><Link className="secondary-button" href="/workspace/publish"><Link2 size={17} /> Generate Share Link</Link><Link className="primary-button" href="/workspace/publish"><Send size={17} /> Publish Agent</Link></section>
      <footer className="candidate-footer"><span>© 2026 Askme. All rights reserved.</span><span>Privacy · Terms · Support</span><span>English</span></footer>
    </div>
  );
}
