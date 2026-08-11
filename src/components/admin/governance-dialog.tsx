"use client";

import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { type FormEvent, useState } from "react";

import { createTranslator, type Locale } from "@/i18n/core";
import { useModalFocus } from "@/components/use-modal-focus";

export function GovernanceDialog({ title, copy, submitLabel, pending, error, locale, onClose, onSubmit }: {
  title: string;
  copy: string;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  locale: Locale;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  const t = createTranslator(locale);
  const dialogRef = useModalFocus(true, onClose, pending);
  function submit(event: FormEvent) { event.preventDefault(); void onSubmit(reason); }
  return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><section ref={dialogRef} className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title" tabIndex={-1}><header><span><AlertTriangle size={20} /></span><div><h2 id="admin-dialog-title">{title}</h2><p>{copy}</p></div><button type="button" onClick={onClose} disabled={pending} aria-label={t("admin.dialog.close")}><X size={18} /></button></header><form onSubmit={submit}><label htmlFor="governance-reason">{t("admin.dialog.reason")}</label><textarea id="governance-reason" minLength={3} maxLength={500} rows={4} required data-autofocus value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} placeholder={t("admin.dialog.placeholder")} />{error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}<footer><button type="button" className="secondary-button" onClick={onClose} disabled={pending}>{t("shared.cancel")}</button><button type="submit" className="primary-button" disabled={pending || reason.trim().length < 3}>{pending ? <LoaderCircle className="spin" size={16} /> : null}{pending ? t("admin.dialog.saving") : submitLabel}</button></footer></form></section></div>;
}
