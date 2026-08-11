"use client";

import { AlertTriangle, LoaderCircle, X } from "lucide-react";
import { type FormEvent, useState } from "react";

export function GovernanceDialog({ title, copy, submitLabel, pending, error, onClose, onSubmit }: {
  title: string;
  copy: string;
  submitLabel: string;
  pending: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (reason: string) => Promise<void>;
}) {
  const [reason, setReason] = useState("");
  function submit(event: FormEvent) { event.preventDefault(); void onSubmit(reason); }
  return <div className="admin-dialog-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !pending) onClose(); }}><section className="admin-dialog" role="dialog" aria-modal="true" aria-labelledby="admin-dialog-title"><header><span><AlertTriangle size={20} /></span><div><h2 id="admin-dialog-title">{title}</h2><p>{copy}</p></div><button type="button" onClick={onClose} disabled={pending} aria-label="Close dialog"><X size={18} /></button></header><form onSubmit={submit}><label htmlFor="governance-reason">Governance reason</label><textarea id="governance-reason" minLength={3} maxLength={500} rows={4} required autoFocus value={reason} disabled={pending} onChange={(event) => setReason(event.target.value)} placeholder="Record the reason for the audit trail." />{error ? <p className="admin-dialog-error" role="alert">{error}</p> : null}<footer><button type="button" className="secondary-button" onClick={onClose} disabled={pending}>Cancel</button><button type="submit" className="primary-button" disabled={pending || reason.trim().length < 3}>{pending ? <LoaderCircle className="spin" size={16} /> : null}{pending ? "Saving…" : submitLabel}</button></footer></form></section></div>;
}
