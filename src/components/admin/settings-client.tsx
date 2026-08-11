"use client";

import { Bot, CheckCircle2, Database, HeartPulse, LoaderCircle, Mail, Save, Send, ServerCog, ShieldCheck } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";

import { createTranslator, type Locale, type TranslationKey } from "@/i18n/core";

import { adminRequest } from "./admin-api";

type Settings = {
  health: {
    database: { status: "ready" };
    migration: { status: "ready" | "outdated"; count: number; expected: string };
    worker: { status: "ready" | "stale" | "missing"; workerId: string | null; version: string | null; lastSeenAt: string | null };
    ai: { status: "configured" | "not_configured"; model: string; baseUrl: string; lastUsage: { outcome: string; errorCode: string | null; createdAt: string } | null };
    mail: { status: "configured" | "not_configured" | "invalid_configuration"; host: string | null; port: number; secure: boolean; from: string | null };
  };
  policies: { publicSessionHourlyLimit: number; publicChatMinuteLimit: number; publicChatDailyLimit: number; negativeFeedbackAutoFlag: boolean };
};

export function SettingsClient({ initialSettings, locale }: { initialSettings: Settings; locale: Locale }) {
  const t = useMemo(() => createTranslator(locale), [locale]);
  const [settings, setSettings] = useState(initialSettings);
  const [policies, setPolicies] = useState(initialSettings.policies);
  const [saving, setSaving] = useState(false);
  const [feedback, setFeedback] = useState<{ tone: "info" | "error"; message: string } | null>(null);
  const [invite, setInvite] = useState({ email: "", displayName: "" });
  const [inviting, setInviting] = useState(false);
  const [inviteFeedback, setInviteFeedback] = useState<{ tone: "info" | "error"; message: string } | null>(null);

  async function save(event: FormEvent) {
    event.preventDefault();
    setSaving(true);
    setFeedback(null);
    try {
      const next = await adminRequest<Settings>("/api/admin/settings", { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify(policies) });
      setSettings(next);
      setPolicies(next.policies);
      setFeedback({ tone: "info", message: t("admin.settings.saved") });
    } catch {
      setFeedback({ tone: "error", message: t("admin.settings.saveFailed") });
    } finally {
      setSaving(false);
    }
  }

  async function sendInvite(event: FormEvent) {
    event.preventDefault();
    setInviting(true);
    setInviteFeedback(null);
    try {
      const result = await adminRequest<{ email: string; status: string; expiresAt: string }>("/api/admin/invitations", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(invite) });
      setInvite({ email: "", displayName: "" });
      setInviteFeedback({ tone: "info", message: t("admin.settings.inviteSent", { email: result.email, date: new Date(result.expiresAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" }) }) });
    } catch {
      setInviteFeedback({ tone: "error", message: t("admin.settings.inviteFailed") });
    } finally {
      setInviting(false);
    }
  }

  const mailReady = settings.health.mail.status === "configured";
  const workerDetail = settings.health.worker.lastSeenAt ? `${settings.health.worker.version} · ${new Date(settings.health.worker.lastSeenAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" })}` : t("admin.health.noHeartbeat");
  const mailDetail = mailReady ? `${settings.health.mail.host}:${settings.health.mail.port} · ${settings.health.mail.from}` : settings.health.mail.status === "invalid_configuration" ? t("admin.health.smtpInvalid") : t("admin.health.smtpMissing");
  return <div className="admin-page">
    <section className="admin-hero compact"><p className="page-kicker">{t("admin.settings.kicker")}</p><h1>{t("admin.settings.title")} <span className="title-seal" aria-hidden="true">问候</span></h1><p>{t("admin.settings.copy")}</p></section>
    <section className="admin-health-grid"><HealthCard title={t("admin.health.database")} status={settings.health.database.status} detail={t("admin.health.databaseCopy")} icon={Database} locale={locale} /><HealthCard title={t("admin.health.migration")} status={settings.health.migration.status} detail={t("admin.health.migrationCopy", { count: settings.health.migration.count, expected: settings.health.migration.expected })} icon={ServerCog} locale={locale} /><HealthCard title={t("admin.health.worker")} status={settings.health.worker.status} detail={workerDetail} icon={HeartPulse} locale={locale} /><HealthCard title={t("admin.health.ai")} status={settings.health.ai.status} detail={`${settings.health.ai.model} · ${settings.health.ai.baseUrl}`} icon={Bot} locale={locale} /><HealthCard title={t("admin.health.mail")} status={settings.health.mail.status} detail={mailDetail} icon={Mail} locale={locale} /></section>
    <div className="admin-settings-grid">
      <section className="admin-card admin-policy-card"><header><div><h2>{t("admin.settings.policies")}</h2><small>{t("admin.settings.policiesCopy")}</small></div><ShieldCheck size={22} /></header>{feedback ? <div className={`inline-feedback ${feedback.tone}`} role={feedback.tone === "error" ? "alert" : "status"}>{feedback.message}</div> : null}<form onSubmit={save}><label>{t("admin.settings.sessionLimit")}<input type="number" min={1} max={100} value={policies.publicSessionHourlyLimit} onChange={(event) => setPolicies((current) => ({ ...current, publicSessionHourlyLimit: Number(event.target.value) }))} /></label><label>{t("admin.settings.minuteLimit")}<input type="number" min={1} max={60} value={policies.publicChatMinuteLimit} onChange={(event) => setPolicies((current) => ({ ...current, publicChatMinuteLimit: Number(event.target.value) }))} /></label><label>{t("admin.settings.dailyLimit")}<input type="number" min={1} max={500} value={policies.publicChatDailyLimit} onChange={(event) => setPolicies((current) => ({ ...current, publicChatDailyLimit: Number(event.target.value) }))} /></label><label className="admin-checkbox"><input type="checkbox" checked={policies.negativeFeedbackAutoFlag} onChange={(event) => setPolicies((current) => ({ ...current, negativeFeedbackAutoFlag: event.target.checked }))} /><span><strong>{t("admin.settings.autoFlag")}</strong><small>{t("admin.settings.autoFlagCopy")}</small></span></label><button className="primary-button" disabled={saving}>{saving ? <LoaderCircle className="spin" size={16} /> : <Save size={16} />}{saving ? t("admin.settings.saving") : t("admin.settings.save")}</button></form></section>
      <section className="admin-card admin-invite-panel" id="invite"><header><div><h2>{t("admin.settings.inviteTitle")}</h2><small>{t("admin.settings.inviteCopy")}</small></div><Mail size={22} /></header>{inviteFeedback ? <div className={`inline-feedback ${inviteFeedback.tone}`} role={inviteFeedback.tone === "error" ? "alert" : "status"}>{inviteFeedback.message}</div> : null}{!mailReady ? <div className="admin-capability-unavailable"><Mail size={29} /><h3>{settings.health.mail.status === "invalid_configuration" ? t("admin.settings.smtpInvalid") : t("admin.settings.smtpMissing")}</h3><p>{t("admin.settings.smtpCopy")}</p></div> : <form onSubmit={sendInvite}><label>{t("admin.settings.displayName")}<input required minLength={1} maxLength={120} value={invite.displayName} onChange={(event) => setInvite((current) => ({ ...current, displayName: event.target.value }))} /></label><label>{t("admin.settings.email")}<input type="email" required maxLength={320} value={invite.email} onChange={(event) => setInvite((current) => ({ ...current, email: event.target.value }))} /></label><button className="primary-button" disabled={inviting}>{inviting ? <LoaderCircle className="spin" size={16} /> : <Send size={16} />}{inviting ? t("admin.settings.sending") : t("admin.settings.send")}</button></form>}<p className="admin-safe-note"><CheckCircle2 size={16} /> {t("admin.settings.tokenCopy")}</p></section>
    </div>
  </div>;
}

function HealthCard({ title, status, detail, icon: Icon, locale }: { title: string; status: string; detail: string; icon: typeof Database; locale: Locale }) {
  const t = createTranslator(locale);
  return <article className="admin-card admin-health-card"><span className={status === "ready" || status === "configured" ? "ready" : status === "not_configured" ? "neutral" : "warning"}><Icon size={23} /></span><div><small>{title}</small><strong>{t(`status.${status}` as TranslationKey)}</strong><p>{detail}</p></div></article>;
}
