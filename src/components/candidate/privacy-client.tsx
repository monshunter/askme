"use client";

import { AlertCircle, BookOpen, Check, ChevronDown, Eye, FileText, Globe2, Link2, LoaderCircle, LockKeyhole, Plus, Quote, RefreshCw, ShieldCheck, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useMemo, useState } from "react";

import { CandidateSourceLink } from "@/components/source-viewer";
import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

import { ApiClientError, requestApi } from "./api-client";

type Visibility = "private" | "agent_only" | "citation_allowed" | "public_preview";
type Material = {
  id: string;
  title: string;
  kind: "file" | "notion" | "website";
  mimeType: string | null;
  externalUrl: string | null;
  status: "queued" | "processing" | "indexed" | "failed";
  visibility: Visibility;
  createdAt: string;
  updatedAt: string;
};
type PreviewMaterial = Pick<Material, "id" | "title" | "kind" | "mimeType" | "externalUrl" | "status" | "visibility" | "updatedAt">;
type PrivacyOverview = {
  materials: { items: Material[]; page: number; pageSize: number; total: number; totalPages: number };
  counts: { private: number; agentOnly: number; citationAllowed: number; publicPreview: number; interviewerAccessible: number; interviewerHidden: number };
  preview: { accessible: PreviewMaterial[]; hidden: PreviewMaterial[] };
  confirmation: { confirmed: boolean; requiresReconfirmation: boolean; policyRevision: number; confirmedAt: string | null };
};
type ApiEnvelope<T = unknown> = { data?: T; error?: { message?: string } | null };

const visibilityOptions: Array<{ value: Visibility; labelKey: TranslationKey; shortKey: TranslationKey }> = [
  { value: "private", labelKey: "privacy.visibility.private", shortKey: "privacy.visibility.private" },
  { value: "agent_only", labelKey: "privacy.visibility.agentOnly", shortKey: "privacy.visibility.short.agent" },
  { value: "citation_allowed", labelKey: "privacy.visibility.citation", shortKey: "privacy.visibility.short.citation" },
  { value: "public_preview", labelKey: "privacy.visibility.publicPreview", shortKey: "privacy.visibility.short.public" },
];

const permissionRows = [
  { labelKey: "privacy.permission.read" as TranslationKey, values: [false, true, true, true] },
  { labelKey: "privacy.permission.answers" as TranslationKey, values: [false, false, true, true] },
  { labelKey: "privacy.permission.cited" as TranslationKey, values: [false, false, true, true] },
  { labelKey: "privacy.permission.highlights" as TranslationKey, values: [false, false, false, true] },
  { labelKey: "privacy.permission.download" as TranslationKey, values: [false, false, false, true] },
];

function sourceIcon(kind: Material["kind"]) {
  if (kind === "notion") return BookOpen;
  if (kind === "website") return Link2;
  return FileText;
}

function feedbackFor(error: unknown, action: string, locale: Locale) {
  const t = createTranslator(locale);
  return error instanceof ApiClientError && error.kind === "invalid_response"
    ? t("privacy.connectionInvalid", { action })
    : t("privacy.connectionFailed", { action });
}

export function PrivacyClient({ initialOverview, locale }: { initialOverview: PrivacyOverview; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [overview, setOverview] = useState(initialOverview);
  const [savingId, setSavingId] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "success" | "error" | "info"; message: string } | null>(null);

  const refresh = useCallback(async () => {
    const { response, payload } = await requestApi<ApiEnvelope<PrivacyOverview>>("/api/privacy?pageSize=20", { cache: "no-store" });
    if (!response.ok) throw new Error(t("privacy.refreshFailed"));
    if (!payload.data) throw new ApiClientError("invalid_response");
    setOverview(payload.data);
    return payload.data;
  }, [t]);

  async function changeVisibility(material: Material, visibility: Visibility) {
    setSavingId(material.id);
    setFeedback(null);
    try {
      const { response, payload } = await requestApi<ApiEnvelope<{ changed: boolean }>>(`/api/privacy/materials/${material.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ visibility }),
      });
      if (!response.ok) {
        setFeedback({ tone: "error", message: t("privacy.saveFailed") });
        return;
      }
      setOverview((current) => ({
        ...current,
        materials: { ...current.materials, items: current.materials.items.map((item) => item.id === material.id ? { ...item, visibility } : item) },
        confirmation: payload.data?.changed ? { ...current.confirmation, confirmed: false, requiresReconfirmation: true, confirmedAt: null } : current.confirmation,
      }));
      await refresh();
      const option = visibilityOptions.find((item) => item.value === visibility);
      setFeedback({ tone: "success", message: t("privacy.changed", { title: material.title, visibility: option ? t(option.labelKey) : visibility }) });
    } catch (error) {
      setFeedback({ tone: "error", message: feedbackFor(error, t("privacy.action.update"), locale) });
    } finally {
      setSavingId(null);
    }
  }

  async function confirmPolicy() {
    setConfirming(true);
    setFeedback(null);
    try {
      const { response } = await requestApi<ApiEnvelope<{ confirmed: boolean }>>("/api/privacy/confirm", { method: "POST" });
      if (!response.ok) {
        setFeedback({ tone: "error", message: t("privacy.confirmFailed") });
        return;
      }
      await refresh();
      setFeedback({ tone: "success", message: t("privacy.confirmedFeedback") });
    } catch (error) {
      setFeedback({ tone: "error", message: feedbackFor(error, t("privacy.action.confirm"), locale) });
    } finally {
      setConfirming(false);
    }
  }

  return (
    <div className="candidate-page privacy-page">
      <section className="page-hero compact-hero privacy-hero">
        <p className="page-kicker">{t("privacy.kicker")}</p>
        <h1>{t("privacy.title")} <span className="title-seal" aria-hidden="true">职问</span></h1>
        <p>{t("privacy.copy")}</p>
      </section>

      {feedback ? <div className={`inline-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.tone === "error" ? <AlertCircle size={18} /> : feedback.tone === "success" ? <Check size={18} /> : <LoaderCircle size={18} />}{feedback.message}<button type="button" onClick={() => setFeedback(null)} aria-label={t("shared.dismiss")}><X size={16} /></button></div> : null}

      <div className="privacy-grid">
        <section className="paper-card visibility-card">
          <div className="section-heading"><span><h2>{t("privacy.manage.title")}</h2><small>{t("privacy.manage.copy")}</small></span><button className="icon-button" type="button" onClick={() => void refresh().catch((error) => setFeedback({ tone: "error", message: feedbackFor(error, t("privacy.action.refresh"), locale) }))} aria-label={t("privacy.manage.refresh")}><RefreshCw size={17} /></button></div>
          {overview.materials.items.length === 0 ? <div className="empty-state"><FileText size={28} /><p>{t("privacy.manage.empty")}</p><Link className="text-link" href="/workspace/materials">{t("privacy.manage.first")}</Link></div> : (
            <div className="visibility-table" role="table" aria-label={t("privacy.manage.table")}>
              <div className="visibility-header" role="row"><span>{t("privacy.manage.source")}</span><span>{t("privacy.manage.visibility")}</span></div>
              {overview.materials.items.map((material) => {
                const Icon = sourceIcon(material.kind);
                return (
                  <div className="visibility-row" role="row" key={material.id}>
                    <span className={`source-kind ${material.kind}`}><Icon size={18} /></span>
                    <span className="visibility-source"><CandidateSourceLink materialId={material.id} title={material.title} kind={material.kind} mimeType={material.mimeType} externalUrl={material.externalUrl} locale={locale} /><small>{material.kind.toUpperCase()} · {t(`status.${material.status}` as TranslationKey)}</small></span>
                    <label className={`visibility-select ${material.visibility}`}>
                      <span className="sr-only">{t("privacy.manage.visibilityFor", { title: material.title })}</span>
                      {savingId === material.id ? <LoaderCircle className="spin" size={15} /> : material.visibility === "private" ? <LockKeyhole size={15} /> : material.visibility === "public_preview" ? <Globe2 size={15} /> : material.visibility === "citation_allowed" ? <Quote size={15} /> : <Eye size={15} />}
                      <select value={material.visibility} disabled={savingId === material.id} onChange={(event) => void changeVisibility(material, event.target.value as Visibility)}>
                        {visibilityOptions.map((option) => <option value={option.value} key={option.value}>{t(option.labelKey)}</option>)}
                      </select><ChevronDown size={14} aria-hidden="true" />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
          <Link className="add-source-link" href="/workspace/materials"><Plus size={16} /> {t("privacy.manage.add")}</Link>
        </section>

        <section className="paper-card policy-card">
          <div className="section-heading"><span><h2>{t("privacy.policy.title")}</h2><small>{t("privacy.policy.copy")}</small></span></div>
          <div className="policy-table" role="table" aria-label={t("privacy.policy.table")}>
            <div className="policy-row policy-header" role="row"><strong>{t("privacy.policy.usage")}</strong>{visibilityOptions.map((option, index) => <span key={option.value}>{index === 0 ? <LockKeyhole size={16} /> : index === 1 ? <Eye size={16} /> : index === 2 ? <Quote size={16} /> : <Globe2 size={16} />}<small>{t(option.shortKey)}</small></span>)}</div>
            {permissionRows.map((row) => <div className="policy-row" role="row" key={row.labelKey}><strong>{t(row.labelKey)}</strong>{row.values.map((allowed, index) => <span key={`${row.labelKey}-${visibilityOptions[index]!.value}`} aria-label={allowed ? t("privacy.allowed") : t("privacy.notAllowed")}>{allowed ? <Check size={16} /> : "—"}</span>)}</div>)}
          </div>
          <p className="policy-note"><ShieldCheck size={15} /> {t("privacy.policy.note")}</p>
        </section>

        <section className="paper-card interviewer-preview-card">
          <div className="section-heading"><span><h2>{t("privacy.preview.title")}</h2><small>{t("privacy.preview.copy")}</small></span></div>
          <div className="preview-columns">
            <PreviewList title={t("privacy.preview.accessible")} tone="accessible" icon={Eye} items={overview.preview.accessible} empty={t("privacy.preview.accessibleEmpty")} locale={locale} />
            <PreviewList title={t("privacy.preview.hidden")} tone="hidden" icon={LockKeyhole} items={overview.preview.hidden} empty={t("privacy.preview.hiddenEmpty")} locale={locale} />
          </div>
        </section>

        <section className={`paper-card confirm-privacy-card ${overview.confirmation.confirmed ? "confirmed" : ""}`}>
          <span className="confirm-policy-icon">{overview.confirmation.confirmed ? <ShieldCheck size={23} /> : <AlertCircle size={23} />}</span>
          <span><h2>{overview.confirmation.confirmed ? t("privacy.confirm.confirmedTitle") : t("privacy.confirm.reviewTitle")}</h2><p>{overview.confirmation.confirmed ? t("privacy.confirm.revision", { revision: overview.confirmation.policyRevision }) : t("privacy.confirm.reviewCopy")}</p></span>
          <ul><li>{t("privacy.confirm.rule1")}</li><li>{t("privacy.confirm.rule2")}</li><li>{t("privacy.confirm.rule3")}</li></ul>
          {!overview.confirmation.confirmed ? <button className="primary-button" type="button" disabled={confirming} onClick={() => void confirmPolicy()}>{confirming ? <LoaderCircle className="spin" size={17} /> : <ShieldCheck size={17} />} {confirming ? t("privacy.confirm.confirming") : overview.confirmation.requiresReconfirmation ? t("privacy.confirm.again") : t("privacy.confirm.submit")}</button> : null}
        </section>
      </div>
      <footer className="candidate-footer"><span>{t("shared.footerRights")}</span><span>{t("shared.footerLinks")}</span></footer>
    </div>
  );
}

function PreviewList({ title, tone, icon: Icon, items, empty, locale }: { title: string; tone: string; icon: typeof Eye; items: PreviewMaterial[]; empty: string; locale: Locale }) {
  const t = createTranslator(locale);
  return (
    <section className={`privacy-preview-list ${tone}`}><h3><Icon size={16} /> {title}<span>{items.length}</span></h3>{items.length === 0 ? <p>{empty}</p> : <ul>{items.map((item) => { const SourceIcon = sourceIcon(item.kind); const option = visibilityOptions.find((entry) => entry.value === item.visibility); return <li key={item.id}><SourceIcon size={15} /><span><CandidateSourceLink materialId={item.id} title={item.title} kind={item.kind} mimeType={item.mimeType} externalUrl={item.externalUrl} locale={locale} /><small>{option ? t(option.labelKey) : item.visibility}</small></span></li>; })}</ul>}</section>
  );
}
