import { ArrowLeft, BookOpen, Bot, FileText, Globe2, MapPin, ShieldCheck, Sparkles } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { LanguageSwitcher } from "@/components/language-switcher";
import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";
import { loadCandidatePublicPreview } from "@/server/publication/public-agent-service";
import { previewRecoveryPath } from "@/server/publication/preview-navigation";

async function loadPreview(ownerId: string) {
  try {
    return await loadCandidatePublicPreview(ownerId);
  } catch (error) {
    const recoveryPath = previewRecoveryPath(error);
    if (recoveryPath) redirect(recoveryPath);
    throw error;
  }
}

export default async function CandidatePublicPreviewPage() {
  const user = await requirePageUser("candidate");
  const [projection, locale] = await Promise.all([loadPreview(user.id), getRequestLocale()]);
  const t = createTranslator(locale);
  return (
    <div className="candidate-page candidate-public-preview-page">
      <div className="preview-toolbar"><Link href="/workspace/publish"><ArrowLeft size={16} /> {t("publish.preview.back")}</Link><span><ShieldCheck size={16} /> {t("publish.preview.permission", { status: t(`status.${projection.agent.status}`) })}</span></div>
      <section className="paper-card public-profile-preview">
        <div className="public-preview-identity">
          <span className="public-avatar">
            {/* Candidate avatar URLs are user data and may not belong to a preconfigured Next image host. */}
            {/* eslint-disable-next-line @next/next/no-img-element */}
            {projection.profile.avatarUrl ? <img src={projection.profile.avatarUrl} alt="" /> : projection.profile.displayName.split(/\s+/).map((part) => part[0]).join("").slice(0, 2)}
          </span>
          <h1>{projection.profile.displayName}</h1><span className="public-agent-badge"><Globe2 size={14} /> {t("publish.preview.badge")}</span>
          <h2>{projection.profile.headline}</h2>{projection.profile.location ? <p><MapPin size={14} /> {projection.profile.location}</p> : null}
          <div className="public-bio">{projection.profile.bio ?? t("publish.preview.bioFallback")}</div>
        </div>
        <div className="public-preview-content">
          <p className="page-kicker">{t("publish.preview.kicker")}</p><h2>{t("publish.preview.title")}</h2>
          <p>{t("publish.preview.copy")}</p>
          <div className="public-preview-stats"><span><BookOpen size={20} /><strong>{projection.stats.publicKnowledgeItems}</strong><small>{t("publish.preview.knowledge")}</small></span><span><FileText size={20} /><strong>{projection.stats.publicSources}</strong><small>{t("publish.preview.sources")}</small></span><span><Bot size={20} /><strong>{projection.agent.status === "published" ? t("status.ready") : t("publish.preview.preview")}</strong><small>{t("publish.preview.agentStatus")}</small></span></div>
          <section className="public-highlight-preview"><h3><Sparkles size={18} /> {t("publish.preview.highlights")}</h3>{projection.highlights.length === 0 ? <p>{t("publish.preview.noHighlights")}</p> : <div>{projection.highlights.map((item) => <article key={item.id}><strong>{item.title}</strong><p>{item.summary}</p>{item.highlights.length > 0 ? <ul>{item.highlights.map((highlight) => <li key={highlight}>{highlight}</li>)}</ul> : null}</article>)}</div>}</section>
          <section className="public-question-preview"><h3>{t("publish.preview.questions")}</h3><div>{projection.suggestedQuestions.map((question) => <span key={question}>{question}</span>)}</div></section>
        </div>
      </section>
      <footer className="candidate-footer"><span>{t("shared.footerRights")}</span><span>{t("publish.preview.footer")}</span><LanguageSwitcher locale={locale} compact /></footer>
    </div>
  );
}
