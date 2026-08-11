import { ShieldCheck } from "lucide-react";
import Link from "next/link";

import { InvitationAcceptClient } from "@/components/admin/invitation-accept-client";
import { requireInvitationToken } from "@/server/admin/admin-input";
import { loadInvitation } from "@/server/admin/invitation-service";
import { AppError } from "@/server/errors";

export const dynamic = "force-dynamic";

async function resolveInvitation(tokenInput: string) {
  try {
    const token = requireInvitationToken(tokenInput);
    return { available: true as const, token, invitation: await loadInvitation(token) };
  } catch (error) {
    if (!(error instanceof AppError)) throw error;
    return { available: false as const };
  }
}

export default async function InvitationPage({ params }: { params: Promise<{ token: string }> }) {
  const result = await resolveInvitation((await params).token);
  if (result.available) return <InvitationAcceptClient token={result.token} invitation={JSON.parse(JSON.stringify(result.invitation))} />;
  return <main className="invitation-page"><Link className="wordmark" href="/">Askme <span aria-hidden="true">问候</span></Link><section className="invitation-card"><div className="admin-empty large"><ShieldCheck size={42} /><h1>Invitation unavailable</h1><p>This invitation is invalid, expired, already used, or revoked.</p><Link className="primary-button" href="/login">Return to sign in</Link></div></section></main>;
}
