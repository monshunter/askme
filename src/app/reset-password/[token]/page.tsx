import { KeyRound, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";

export default async function ResetPasswordPage({ params, searchParams }: { params: Promise<{ token: string }>; searchParams: Promise<{ error?: string }> }) {
  const [{ token }, { error }, locale] = await Promise.all([params, searchParams, getRequestLocale()]);
  const t = createTranslator(locale);
  const validToken = /^[A-Za-z0-9_-]{43}$/.test(token);
  return <main className="login-page"><section className="login-story" aria-labelledby="reset-story-title"><Link className="wordmark" href="/" aria-label="Askme">Askme <span aria-hidden="true">职问</span></Link><div className="story-copy"><p className="eyebrow">{t("login.eyebrow")}</p><h1 id="reset-story-title">{t("login.hero")}</h1><p>{t("login.heroCopy")}</p></div><p className="trust-line"><ShieldCheck size={18} /> {t("login.trust")}</p></section><section className="login-panel" aria-labelledby="reset-title"><div className="login-card"><p className="seal" aria-hidden="true">职问</p><h2 id="reset-title">{t("reset.title")}</h2><p className="muted">{t("reset.copy")}</p>{error || !validToken ? <p className="form-error" role="alert">{t("reset.invalid")}</p> : null}{validToken ? <form action="/api/auth/reset-password" method="post"><input type="hidden" name="token" value={token} /><label htmlFor="password">{t("account.newPassword")}</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><small className="muted">{t("auth.passwordHint")}</small><label htmlFor="confirmPassword">{t("auth.confirmPassword")}</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><button type="submit"><KeyRound size={18} /> {t("reset.submit")}</button></form> : null}<nav className="auth-links"><Link href="/login">{t("auth.backToLogin")}</Link><Link href="/forgot-password">{t("login.forgot")}</Link></nav></div></section></main>;
}
