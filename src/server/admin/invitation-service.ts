import "server-only";

import { getRuntimeConfig } from "@/server/config";
import { hashPassword } from "@/server/auth/crypto";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import type { InvitationAcceptance, InvitationInput } from "./admin-input";
import { createInvitationCredential, hashInvitationToken } from "./invitation-token";
import { sendAdminInvitationEmail } from "./smtp-mailer";

const INVITATION_TTL_MS = 48 * 60 * 60 * 1_000;

export async function createAdminInvitation(actorId: string, input: InvitationInput, origin: string, requestId?: string) {
  if (getRuntimeConfig().mail.status !== "configured") {
    throw new AppError("MAIL_NOT_CONFIGURED", "Admin invitations are unavailable until SMTP is configured.", 409);
  }
  const recentInvitations = await getPool().query<{ count: number }>(
    `SELECT count(*)::int AS count FROM audit_events
     WHERE actor_id=$1 AND action='admin.invitation.create' AND created_at>now()-interval '1 hour'`,
    [actorId],
  );
  if ((recentInvitations.rows[0]?.count ?? 0) >= 10) {
    throw new AppError("INVITATION_RATE_LIMITED", "Too many invitations were requested. Wait before trying again.", 429, { retryAfterSeconds: 3_600 });
  }
  const credential = createInvitationCredential();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const client = await getPool().connect();
  let invitation: { id: string; email: string; displayName: string; expiresAt: Date };
  try {
    await client.query("BEGIN");
    const existingUser = await client.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1", [input.email]);
    if (existingUser.rows[0]) throw new AppError("INVITATION_ACCOUNT_EXISTS", "An account already exists for this email address.", 409);
    await client.query(
      `UPDATE admin_invitations SET status='revoked',revoked_at=now(),updated_at=now()
       WHERE lower(email)=lower($1) AND status IN ('pending','sent') AND expires_at<=now()`,
      [input.email],
    );
    const inserted = await client.query<{ id: string; email: string; displayName: string; expiresAt: Date }>(
      `INSERT INTO admin_invitations(email,display_name,token_hash,invited_by,expires_at)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING id,email,display_name AS "displayName",expires_at AS "expiresAt"`,
      [input.email, input.displayName, credential.tokenHash, actorId, expiresAt],
    );
    invitation = inserted.rows[0]!;
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'admin','admin.invitation.create','admin_invitation',$2,'pending',$3,$4::jsonb)`,
      [actorId, invitation.id, requestId ?? null, JSON.stringify({ email: input.email, expiresAt: expiresAt.toISOString() })],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new AppError("INVITATION_ACTIVE", "An active invitation already exists for this email address.", 409);
    }
    throw error;
  } finally {
    client.release();
  }

  try {
    await sendAdminInvitationEmail({
      to: invitation.email,
      displayName: invitation.displayName,
      invitationUrl: `${origin.replace(/\/$/, "")}/invite/${credential.token}`,
      expiresAt: invitation.expiresAt,
    });
    await getPool().query(
      `WITH updated AS (
         UPDATE admin_invitations SET status='sent',sent_at=now(),updated_at=now()
         WHERE id=$1 AND status='pending' RETURNING id
       )
       INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       SELECT $2,'admin','admin.invitation.send','admin_invitation',id,'sent',$3,'{}'::jsonb FROM updated`,
      [invitation.id, actorId, requestId ?? null],
    );
    return { id: invitation.id, email: invitation.email, displayName: invitation.displayName, status: "sent" as const, expiresAt: invitation.expiresAt };
  } catch (error) {
    const safeError = error instanceof AppError ? error : new AppError("MAIL_SEND_FAILED", "The invitation email could not be sent.", 502);
    await getPool().query(
      `WITH updated AS (
         UPDATE admin_invitations SET status='failed',failed_at=now(),error_code=$2,updated_at=now()
         WHERE id=$1 AND status='pending' RETURNING id
       )
       INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       SELECT $3,'admin','admin.invitation.send','admin_invitation',id,'failed',$4,jsonb_build_object('errorCode',$2::text) FROM updated`,
      [invitation.id, safeError.code, actorId, requestId ?? null],
    );
    throw safeError;
  }
}

export async function loadInvitation(token: string) {
  const result = await getPool().query<{ email: string; displayName: string; expiresAt: Date }>(
    `SELECT email,display_name AS "displayName",expires_at AS "expiresAt"
     FROM admin_invitations WHERE token_hash=$1 AND status='sent' AND expires_at>now() LIMIT 1`,
    [hashInvitationToken(token)],
  );
  const invitation = result.rows[0];
  if (!invitation) throw new AppError("INVITATION_UNAVAILABLE", "This invitation is unavailable or expired.", 410);
  return invitation;
}

export async function acceptAdminInvitation(token: string, input: InvitationAcceptance, requestId?: string) {
  await loadInvitation(token);
  const passwordHash = await hashPassword(input.password);
  const tokenHash = hashInvitationToken(token);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const invitationResult = await client.query<{ id: string; email: string }>(
      `SELECT id,email FROM admin_invitations
       WHERE token_hash=$1 AND status='sent' AND expires_at>now() FOR UPDATE`,
      [tokenHash],
    );
    const invitation = invitationResult.rows[0];
    if (!invitation) throw new AppError("INVITATION_UNAVAILABLE", "This invitation is unavailable or expired.", 410);
    const existing = await client.query("SELECT id FROM users WHERE lower(email)=lower($1) LIMIT 1", [invitation.email]);
    if (existing.rows[0]) throw new AppError("INVITATION_ACCOUNT_EXISTS", "An account already exists for this email address.", 409);
    const userResult = await client.query<{ id: string }>(
      `INSERT INTO users(email,password_hash,role,status,display_name)
       VALUES ($1,$2,'admin','active',$3) RETURNING id`,
      [invitation.email, passwordHash, input.displayName],
    );
    const userId = userResult.rows[0]!.id;
    await client.query("UPDATE admin_invitations SET status='accepted',accepted_at=now(),updated_at=now() WHERE id=$1", [invitation.id]);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'admin','admin.invitation.accept','admin_invitation',$2,'accepted',$3,'{}'::jsonb)`,
      [userId, invitation.id, requestId ?? null],
    );
    await client.query("COMMIT");
    return { accepted: true, email: invitation.email };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
