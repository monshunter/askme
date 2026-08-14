import { KeyRound, ShieldCheck } from "lucide-react";

import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";

export default async function AccountPage({ searchParams }: { searchParams: Promise<{ changed?: string; error?: string }> }) {
  const [user, { changed, error }, locale] = await Promise.all([requirePageUser("candidate"), searchParams, getRequestLocale()]);
  const t = createTranslator(locale);
  return <section className="account-security-page"><header><div><p className="page-kicker">{t("account.kicker")}</p><h1>{t("account.title")}</h1><p>{t("account.copy")}</p></div><span><ShieldCheck size={28} /></span></header><article className="account-security-card"><div><strong>{user.displayName}</strong><small>{user.email}</small></div>{changed ? <p className="form-success" role="status">{t("account.changed")}</p> : null}{error ? <p className="form-error" role="alert">{t(error === "reuse" ? "account.reuse" : "account.currentInvalid")}</p> : null}<form action="/api/auth/password" method="post"><label htmlFor="currentPassword">{t("account.currentPassword")}</label><input id="currentPassword" name="currentPassword" type="password" autoComplete="current-password" maxLength={200} required /><label htmlFor="newPassword">{t("account.newPassword")}</label><input id="newPassword" name="newPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><small>{t("auth.passwordHint")}</small><label htmlFor="confirmPassword">{t("auth.confirmPassword")}</label><input id="confirmPassword" name="confirmPassword" type="password" autoComplete="new-password" minLength={12} maxLength={200} required /><button className="primary-button" type="submit"><KeyRound size={17} /> {t("account.submit")}</button></form></article></section>;
}
