"use client";

import { CheckCircle2, LoaderCircle, ShieldCheck } from "lucide-react";
import Link from "next/link";
import { type FormEvent, useState } from "react";

import { createTranslator, type Locale } from "@/i18n/core";

import { adminRequest } from "./admin-api";

export function InvitationAcceptClient({ token, invitation, locale }: { token: string; invitation: { email: string; displayName: string; expiresAt: string }; locale: Locale }) {
  const t = createTranslator(locale);
  const [displayName, setDisplayName] = useState(invitation.displayName); const [password, setPassword] = useState(""); const [confirm, setConfirm] = useState(""); const [pending, setPending] = useState(false); const [error, setError] = useState<string | null>(null); const [accepted, setAccepted] = useState(false);
  async function submit(event: FormEvent) { event.preventDefault(); if (password !== confirm) { setError(t("invite.passwordMismatch")); return; } setPending(true); setError(null); try { await adminRequest(`/api/invitations/${token}`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ displayName, password }) }); setAccepted(true); } catch { setError(t("invite.acceptFailed")); } finally { setPending(false); } }
  return <main className="invitation-page"><Link className="wordmark" href="/">Askme <span aria-hidden="true">职问</span></Link><section className="invitation-card">{accepted ? <div className="admin-empty large"><CheckCircle2 size={42} /><h1>{t("invite.created")}</h1><p>{t("invite.createdCopy", { email: invitation.email })}</p><Link className="primary-button" href="/login">{t("invite.signIn")}</Link></div> : <><span className="invitation-icon"><ShieldCheck size={28} /></span><p className="page-kicker">{t("invite.kicker")}</p><h1>{t("invite.title")}</h1><p>{t("invite.copy", { email: invitation.email, date: new Date(invitation.expiresAt).toLocaleString(locale === "zh-CN" ? "zh-CN" : "en-US", { timeZone: "UTC" }) })}</p>{error ? <div className="inline-feedback error" role="alert">{error}</div> : null}<form onSubmit={submit}><label>{t("invite.displayName")}<input required minLength={1} maxLength={120} value={displayName} onChange={(event) => setDisplayName(event.target.value)} /></label><label>{t("invite.password")}<input type="password" required minLength={12} maxLength={200} value={password} onChange={(event) => setPassword(event.target.value)} /></label><label>{t("invite.confirm")}<input type="password" required minLength={12} maxLength={200} value={confirm} onChange={(event) => setConfirm(event.target.value)} /></label><button className="primary-button" disabled={pending || password.length < 12 || password !== confirm}>{pending ? <LoaderCircle className="spin" size={16} /> : <ShieldCheck size={16} />}{pending ? t("invite.creating") : t("invite.accept")}</button></form></>}</section></main>;
}
