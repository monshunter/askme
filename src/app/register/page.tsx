import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { redirect } from "next/navigation";

import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";
import { currentPageUser } from "@/server/auth/current";

export default async function RegisterPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const [user, { error }, locale] = await Promise.all([currentPageUser(), searchParams, getRequestLocale()]);
  if (user) redirect(user.role === "admin" ? "/admin" : "/workspace");
  const t = createTranslator(locale);
  return <main className="login-page"><section className="login-story" aria-labelledby="register-story-title"><Link className="wordmark" href="/" aria-label="Askme">Askme <span aria-hidden="true">职问</span></Link><div className="story-copy"><p className="eyebrow">{t("login.eyebrow")}</p><h1 id="register-story-title">{t("login.hero")}</h1><p>{t("login.heroCopy")}</p></div><p className="trust-line"><ShieldCheck size={18} /> {t("login.trust")}</p></section><section className="login-panel" aria-labelledby="register-title"><div className="login-card"><p className="seal" aria-hidden="true">职问</p><h2 id="register-title">{t("register.title")}</h2><p className="muted">{t("register.copy")}</p>{error ? <p className="form-error" role="alert">{t(error === "exists" ? "register.exists" : "register.invalid")}</p> : null}<form action="/api/auth/register" method="post"><label htmlFor="displayName">{t("auth.displayName")}</label><input id="displayName" name="displayName" autoComplete="name" minLength={1} maxLength={120} required /><label htmlFor="email">{t("login.email")}</label><input id="email" name="email" type="email" autoComplete="email" maxLength={320} required /><label htmlFor="password">{t("login.password")}</label><input id="password" name="password" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><small className="muted">{t("auth.passwordHint")}</small><label htmlFor="confirmPassword">{t("auth.confirmPassword")}</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><button type="submit">{t("register.submit")} <ArrowRight size={18} /></button></form><nav className="auth-links"><Link href="/login">{t("auth.backToLogin")}</Link></nav></div></section></main>;
}
