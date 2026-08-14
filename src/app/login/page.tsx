import { ArrowRight, ShieldCheck } from "lucide-react";
import Link from "next/link";

import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ error?: string; reset?: string }> }) {
  const [{ error, reset }, locale] = await Promise.all([searchParams, getRequestLocale()]);
  const t = createTranslator(locale);

  return (
    <main className="login-page">
      <section className="login-story" aria-labelledby="login-story-title">
        <Link className="wordmark" href="/" aria-label="Askme">
          Askme <span aria-hidden="true">职问</span>
        </Link>
        <div className="story-copy">
          <p className="eyebrow">{t("login.eyebrow")}</p>
          <h1 id="login-story-title">{t("login.hero")}</h1>
          <p>{t("login.heroCopy")}</p>
        </div>
        <p className="trust-line"><ShieldCheck size={18} /> {t("login.trust")}</p>
      </section>

      <section className="login-panel" aria-labelledby="login-title">
        <div className="login-card">
          <p className="seal" aria-hidden="true">职问</p>
          <h2 id="login-title">{t("login.title")}</h2>
          <p className="muted">{t("login.copy")}</p>

          {error ? <p className="form-error" role="alert">{t("login.invalid")}</p> : null}
          {reset ? <p className="form-success" role="status">{t("login.reset")}</p> : null}

          <form action="/api/auth/login" method="post">
            <label htmlFor="email">{t("login.email")}</label>
            <input id="email" name="email" type="email" autoComplete="email" required />
            <label htmlFor="password">{t("login.password")}</label>
            <input id="password" name="password" type="password" autoComplete="current-password" required />
            <button type="submit">{t("login.submit")} <ArrowRight size={18} /></button>
          </form>
          <nav className="auth-links" aria-label={t("login.title")}><Link href="/forgot-password">{t("login.forgot")}</Link><Link href="/register">{t("login.register")}</Link></nav>
          <p className="local-note">{t("login.local")}</p>
        </div>
      </section>
    </main>
  );
}
