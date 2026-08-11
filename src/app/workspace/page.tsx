import { ArrowRight, BookOpen, Bot, Check, CircleAlert, FileText, MessageSquareText, Quote, ShieldCheck, UploadCloud } from "lucide-react";
import Link from "next/link";

import { LanguageSwitcher } from "@/components/language-switcher";
import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";
import { getCandidateDashboard } from "@/server/dashboard/dashboard-service";

const actionContent: Record<string, { titleKey: TranslationKey; copyKey: TranslationKey; href: string; icon: typeof ShieldCheck }> = {
  configure_ai: { titleKey: "dashboard.action.configureAi.title", copyKey: "dashboard.action.configureAi.copy", href: "/workspace/materials", icon: Bot },
  review_failed_materials: { titleKey: "dashboard.action.failed.title", copyKey: "dashboard.action.failed.copy", href: "/workspace/materials", icon: CircleAlert },
  upload_materials: { titleKey: "dashboard.action.upload.title", copyKey: "dashboard.action.upload.copy", href: "/workspace/materials", icon: UploadCloud },
  wait_for_processing: { titleKey: "dashboard.action.processing.title", copyKey: "dashboard.action.processing.copy", href: "/workspace/materials", icon: Bot },
  configure_privacy: { titleKey: "dashboard.action.privacy.title", copyKey: "dashboard.action.privacy.copy", href: "/workspace/privacy", icon: ShieldCheck },
  preview_agent: { titleKey: "dashboard.action.preview.title", copyKey: "dashboard.action.preview.copy", href: "/workspace/agent", icon: Bot },
};

const statusKeys: Record<string, TranslationKey> = {
  draft: "status.draft", ready: "status.ready", published: "status.published", paused: "status.paused", revoked: "status.revoked",
  completed: "status.completed", available: "status.available", locked: "status.locked", queued: "status.queued", processing: "status.processing", indexed: "status.indexed", failed: "status.failed",
};

function prettyStatus(status: string, locale: Locale) {
  const key = statusKeys[status];
  return key ? createTranslator(locale)(key) : status.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function formatDate(value: Date | string, locale: Locale) {
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-US", { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZone: "UTC", timeZoneName: "short" }).format(new Date(value));
}

export default async function WorkspacePage() {
  const user = await requirePageUser("candidate");
  const [dashboard, locale] = await Promise.all([getCandidateDashboard(user.id), getRequestLocale()]);
  const t = createTranslator(locale);
  const metricCards = [
    { label: t("dashboard.metric.materials"), value: dashboard.metrics.sourceMaterials, icon: FileText, tone: "teal" },
    { label: t("dashboard.metric.knowledge"), value: dashboard.metrics.knowledgeItems, icon: BookOpen, tone: "green" },
    { label: t("dashboard.metric.citations"), value: `${dashboard.citationRatio}%`, icon: Quote, tone: "blue" },
    { label: t("dashboard.metric.agent"), value: prettyStatus(dashboard.agentStatus, locale), icon: Bot, tone: "orange" },
  ];
  const workflowCopy: Record<string, { title: string; copy: string; icon: typeof UploadCloud }> = {
    materials: { title: t("dashboard.workflow.materials.title"), copy: t("dashboard.workflow.materials.copy"), icon: UploadCloud },
    knowledge: { title: t("dashboard.workflow.knowledge.title"), copy: t("dashboard.workflow.knowledge.copy"), icon: BookOpen },
    agent: { title: t("dashboard.workflow.agent.title"), copy: t("dashboard.workflow.agent.copy"), icon: Bot },
    interviewer_chat: { title: t("dashboard.workflow.chat.title"), copy: t("dashboard.workflow.chat.copy"), icon: MessageSquareText },
  };

  return (
    <div className="candidate-page dashboard-page">
      <section className="page-hero dashboard-hero">
        <p className="page-kicker">{t("dashboard.kicker")}</p>
        <h1>{t("dashboard.heroLine1")}<br /><em>{t("dashboard.heroLine2")}</em> <span className="title-seal" aria-hidden="true">问候</span></h1>
        <p>{t("dashboard.heroCopy1")}<br />{t("dashboard.heroCopy2")}</p>
      </section>

      <section className="metric-grid" aria-label="Workspace metrics">
        {metricCards.map(({ label, value, icon: Icon, tone }) => (
          <article className="metric-card" key={label}>
            <span className={`metric-icon ${tone}`}><Icon size={30} /></span>
            <span><small>{label}</small><strong>{value}</strong><span className="metric-note">{t("dashboard.metric.note")}</span></span>
          </article>
        ))}
      </section>

      <section className="paper-card workflow-card">
        <h2>{t("dashboard.workflow.title")}</h2>
        <div className="workflow-steps">
          {dashboard.workflow.map((step, index) => {
            const content = workflowCopy[step.id]!;
            const Icon = content.icon;
            return (
              <div className="workflow-fragment" key={step.id}>
                <article className={`workflow-step ${step.status}`}>
                  <span className="workflow-icon"><Icon size={28} /></span>
                  <h3><span>{index + 1}</span>{content.title}</h3>
                  <p>{content.copy}</p>
                  <small><Check size={13} /> {prettyStatus(step.status, locale)}</small>
                </article>
                {index < dashboard.workflow.length - 1 ? <ArrowRight className="workflow-arrow" aria-hidden="true" /> : null}
              </div>
            );
          })}
        </div>
      </section>

      <div className="dashboard-lower-grid">
        <section className="paper-card recent-card">
          <div className="section-heading"><h2>{t("dashboard.recent.title")}</h2><Link href="/workspace/materials">{t("dashboard.viewAll")}</Link></div>
          {dashboard.recentMaterials.length === 0 ? (
            <div className="empty-state"><UploadCloud size={28} /><p>{t("dashboard.empty.materials")}</p><Link className="text-link" href="/workspace/materials">{t("dashboard.empty.upload")}</Link></div>
          ) : (
            <ul className="material-list compact-list">
              {dashboard.recentMaterials.map((material) => (
                <li key={String(material.id)}>
                  <span className="file-tile"><FileText size={18} /></span>
                  <span className="list-main"><strong>{String(material.title)}</strong><small>{String(material.kind).toUpperCase()} · {formatDate(material.createdAt as string, locale)}</small></span>
                  <span className={`status-pill ${String(material.status)}`}>{prettyStatus(String(material.status), locale)}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
        <section className="paper-card actions-card">
          <h2>{t("dashboard.actions.title")}</h2>
          {dashboard.nextActions.length === 0 ? <div className="empty-state"><Check size={28} /><p>{t("dashboard.actions.ready")}</p></div> : null}
          <div className="action-list">
            {dashboard.nextActions.map((action) => {
              const content = actionContent[action];
              if (!content) return null;
              const Icon = content.icon;
              return <Link href={content.href} key={action}><span className="round-icon"><Icon size={20} /></span><span><strong>{t(content.titleKey)}</strong><small>{t(content.copyKey)}</small></span><ArrowRight size={17} /></Link>;
            })}
          </div>
          <p className="calligraphy-line" aria-hidden="true">其 料 实 料　自 信 应 答 <span>问</span></p>
        </section>
      </div>
      <footer className="candidate-footer"><span>{t("shared.footerRights")}</span><span>{t("shared.footerLinks")}</span><LanguageSwitcher locale={locale} compact /></footer>
    </div>
  );
}
