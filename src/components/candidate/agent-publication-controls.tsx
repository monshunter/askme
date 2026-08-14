"use client";

import { AlertCircle, Check, CheckCircle2, ExternalLink, FileText, Globe2, LoaderCircle, LockKeyhole, RefreshCw, Send, ShieldCheck, X, XCircle } from "lucide-react";
import Link from "next/link";
import { useMemo, useState } from "react";

import { useModalFocus } from "@/components/use-modal-focus";
import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

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
export type PublicationOverview = {
  publication: Publication | null;
  readiness: { ready: boolean; checks: Array<{ key: ReadinessKey; label: string; detail: string; ready: boolean }> };
  publicMode: boolean;
  publicEvidence: number;
  shareUrl: string | null;
};
type ApiEnvelope<T> = { data?: T; error?: { message?: string } | null };

function connectionFeedback(error: unknown, action: string, locale: Locale) {
  const t = createTranslator(locale);
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? t("publish.connectionInvalid", { action })
    : t("publish.connectionFailed", { action });
}

function requirementHref(key: ReadinessKey) {
  if (key === "indexed_material") return "/workspace/materials";
  if (key === "privacy_confirmation") return "/workspace/privacy";
  return "/workspace/account?returnTo=/workspace/agent#public-profile";
}

function requirementText(key: ReadinessKey, ready: boolean, field: "label" | "detail"): TranslationKey {
  if (key === "indexed_material") return field === "label" ? "publish.requirement.indexed" : ready ? "publish.requirement.indexedReady" : "publish.requirement.indexedBlocked";
  if (key === "privacy_confirmation") return field === "label" ? "publish.requirement.privacy" : ready ? "publish.requirement.privacyReady" : "publish.requirement.privacyBlocked";
  return field === "label" ? "publish.requirement.identity" : ready ? "publish.requirement.identityReady" : "publish.requirement.identityBlocked";
}

export function AgentPublicationControls({ initialOverview, locale, publicMode, onPublicModeChange }: { initialOverview: PublicationOverview; locale: Locale; publicMode: boolean; onPublicModeChange: (publicMode: boolean) => void }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [overview, setOverview] = useState(initialOverview);
  const [action, setAction] = useState<"publish" | "revoke" | null>(null);
  const [confirmRevoke, setConfirmRevoke] = useState(false);
  const [notice, setNotice] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);
  const revokeDialogRef = useModalFocus(confirmRevoke, () => setConfirmRevoke(false), action === "revoke");

  async function refresh() {
    const { response, payload } = await requestApi<ApiEnvelope<PublicationOverview>>("/api/publications/current", { cache: "no-store" });
    if (!response.ok) throw new Error(t("publish.refreshFailed"));
    if (!payload.data) throw new ApiClientError("invalid_response");
    setOverview(payload.data);
    onPublicModeChange(payload.data.publicMode);
    return payload.data;
  }

  async function mutate(kind: "publish" | "revoke", path: string) {
    setAction(kind);
    setNotice(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<{ changed: boolean; publication: Publication; shareUrl?: string }>>(path, { method: "POST" });
      if (!response.ok) {
        setNotice({ tone: "error", message: t("publish.actionFailed", { action: t(`publish.action.${kind}` as TranslationKey) }) });
        await refresh().catch(() => undefined);
        return;
      }
      const current = await refresh();
      if (kind === "publish") setNotice({ tone: "success", message: payload.data?.changed ? t("publish.nowPublic") : t("publish.already") });
      if (kind === "revoke") setNotice({ tone: "success", message: t("publish.revoked") });
      if (kind === "revoke" || !current.publication) setConfirmRevoke(false);
    } catch (error) {
      setNotice({ tone: "error", message: connectionFeedback(error, t(`publish.action.${kind}` as TranslationKey), locale) });
    } finally {
      setAction(null);
    }
  }

  const published = overview.publication?.status === "published";
  return (
    <section className="agent-publication-section" aria-labelledby="agent-publication-title">
      <div className="section-heading agent-publication-heading"><span><h2 id="agent-publication-title">{t("agent.publish.title")}</h2><p>{t("agent.publish.copy")}</p></span></div>
      {notice ? <div className={`inline-feedback ${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>{notice.tone === "error" ? <AlertCircle size={18} /> : notice.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{notice.message}<button type="button" onClick={() => setNotice(null)} aria-label={t("shared.dismiss")}><X size={16} /></button></div> : null}

      <div className="publish-layout">
        <section className="paper-card readiness-card">
          <header><span className={overview.readiness.ready ? "ready" : "blocked"}>{overview.readiness.ready ? <ShieldCheck size={24} /> : <AlertCircle size={24} />}</span><span><h2>{overview.readiness.ready ? t("publish.readiness.ready") : t("publish.readiness.blocked")}</h2><p>{t("publish.readiness.copy")}</p></span><button className="icon-button" type="button" onClick={() => void refresh().catch((error) => setNotice({ tone: "error", message: connectionFeedback(error, t("publish.action.refresh"), locale) }))} aria-label={t("publish.readiness.refresh")}><RefreshCw size={17} /></button></header>
          <div className="readiness-list">{overview.readiness.checks.map((check) => <article className={check.ready ? "ready" : "blocked"} key={check.key}>{check.ready ? <CheckCircle2 size={20} /> : <XCircle size={20} />}<span><strong>{t(requirementText(check.key, check.ready, "label"))}</strong><small>{t(requirementText(check.key, check.ready, "detail"))}</small></span>{!check.ready ? <Link href={requirementHref(check.key)}>{t("publish.requirement.resolve")}</Link> : null}</article>)}</div>
          <p className={`public-evidence-note ${overview.publicEvidence > 0 ? "ready" : "warning"}`}><FileText size={16} /> {overview.publicEvidence > 0 ? t("publish.evidence.ready", { count: overview.publicEvidence }) : t("publish.evidence.empty")}</p>
        </section>

        <section className="paper-card publication-status-card">
          <div className={`publication-orb ${published ? "published" : overview.publication ? "draft" : "none"}`}>{published ? <Globe2 size={31} /> : <LockKeyhole size={30} />}</div>
          <span className={`publication-status ${published ? "published" : overview.publication ? "draft" : "none"}`}>{published ? t("status.published") : overview.publication ? t("publish.status.draftLink") : t("publish.status.notPublished")}</span>
          <h2>{published ? t("publish.status.publicTitle") : overview.publication ? t("publish.status.draftTitle") : t("publish.status.createTitle")}</h2>
          <p>{published ? publicMode ? t("publish.status.publicCopy") : t("publish.status.modeOff") : t("publish.status.privateCopy")}</p>
          {overview.publication?.publishedAt ? <small>{t("publish.status.publishedAt", { date: new Date(overview.publication.publishedAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" }) })}</small> : null}
        </section>

        <section className="paper-card publish-action-card">
          <span className="publish-action-icon"><Send size={23} /></span><span><h2>{published ? t("publish.manage.title") : t("publish.manage.publishTitle")}</h2><p>{published ? t("publish.manage.copy") : t("publish.manage.publishCopy")}</p></span>
          {!published ? <button className="primary-button" type="button" disabled={Boolean(action) || !overview.readiness.ready} onClick={() => void mutate("publish", "/api/publications/publish")}>{action === "publish" ? <LoaderCircle className="spin" size={17} /> : <Send size={17} />} {t("agent.publish.submit")}</button> : <div className="published-actions">{!publicMode ? <button className="primary-button" type="button" disabled={Boolean(action)} onClick={() => void mutate("publish", "/api/publications/publish")}>{action === "publish" ? <LoaderCircle className="spin" size={17} /> : <Globe2 size={17} />} {t("publish.manage.enable")}</button> : overview.shareUrl ? <a className="secondary-button" href={overview.shareUrl} target="_blank" rel="noreferrer"><ExternalLink size={17} /> {t("publish.manage.visit")}</a> : null}<button className="danger-button" type="button" disabled={Boolean(action)} onClick={() => setConfirmRevoke(true)}><LockKeyhole size={17} /> {t("publish.manage.revoke")}</button></div>}
        </section>
      </div>

      {confirmRevoke ? <div className="confirm-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setConfirmRevoke(false); }}><section ref={revokeDialogRef} className="confirm-dialog" role="alertdialog" aria-modal="true" aria-labelledby="revoke-title" aria-describedby="revoke-description" tabIndex={-1}><span className="confirm-icon"><AlertCircle size={26} /></span><h2 id="revoke-title">{t("publish.confirm.title")}</h2><p id="revoke-description">{t("publish.confirm.copy")}</p><div><button className="secondary-button" type="button" data-autofocus onClick={() => setConfirmRevoke(false)}>{t("publish.confirm.keep")}</button><button className="danger-button" type="button" disabled={action === "revoke"} onClick={() => void mutate("revoke", "/api/publications/revoke")}>{action === "revoke" ? <LoaderCircle className="spin" size={17} /> : <LockKeyhole size={17} />} {t("publish.confirm.revoke")}</button></div></section></div> : null}
    </section>
  );
}
