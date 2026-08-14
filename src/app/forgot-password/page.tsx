import { Mail, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";

export default async function ForgotPasswordPage({ searchParams }: { searchParams: Promise<{ sent?: string; error?: string }> }) {
  const [{ sent, error }, locale] = await Promise.all([searchParams, getRequestLocale()]);
  const t = createTranslator(locale);
  return <main className="login-page"><section className="login-story" aria-labelledby="forgot-story-title"><Link className="wordmark" href="/" aria-label="Askme">Askme <span aria-hidden="true">职问</span></Link><div className="story-copy"><p className="eyebrow">{t("login.eyebrow")}</p><h1 id="forgot-story-title">{t("login.hero")}</h1><p>{t("login.heroCopy")}</p></div><p className="trust-line"><ShieldCheck size={18} /> {t("login.trust")}</p></section><section className="login-panel" aria-labelledby="forgot-title"><div className="login-card"><p className="seal" aria-hidden="true">职问</p><h2 id="forgot-title">{t("forgot.title")}</h2><p className="muted">{t("forgot.copy")}</p>{sent ? <p className="form-success" role="status">{t("forgot.sent")}</p> : null}{error ? <p className="form-error" role="alert">{t(error === "mail" ? "forgot.mailUnavailable" : "forgot.invalid")}</p> : null}<form action="/api/auth/forgot-password" method="post"><label htmlFor="email">{t("login.email")}</label><input id="email" name="email" type="email" autoComplete="email" maxLength={320} required /><button type="submit"><Mail size={18} /> {t("forgot.submit")}</button></form><nav className="auth-links"><Link href="/login">{t("auth.backToLogin")}</Link><Link href="/register">{t("login.register")}</Link></nav></div></section></main>;
}
