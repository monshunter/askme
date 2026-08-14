import "server-only";

import { getRuntimeConfig } from "@/server/config";
import { getPool } from "@/server/db/client";
import { AppError } from "@/server/errors";

import { createSessionCredential, hashPassword, hashSessionToken, verifyPassword } from "./crypto";
import type { CandidateProfileInput, ChangePasswordInput, ForgotPasswordInput, RegistrationInput, ResetPasswordInput } from "./auth-input";
import { sendPasswordResetEmail } from "./password-mailer";
import { publicAppUrl } from "@/server/mail/public-url";

const RESET_TTL_MS = 30 * 60 * 1_000;

export async function registerCandidate(input: RegistrationInput, requestId?: string) {
  const passwordHash = await hashPassword(input.password);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      id: string; email: string; role: "candidate"; locale: string; displayName: string;
      headline: string | null; location: string | null; bio: string | null; avatarUrl: string | null;
    }>(
      `INSERT INTO users(email,password_hash,role,status,display_name)
       VALUES ($1,$2,'candidate','active',$3)
       RETURNING id,email,role,locale,display_name AS "displayName",headline,location,bio,avatar_url AS "avatarUrl"`,
      [input.email, passwordHash, input.displayName],
    );
    const user = result.rows[0]!;
    await client.query("INSERT INTO agent_settings(owner_id) VALUES ($1)", [user.id]);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','auth.register','user',$1::uuid::text,'created',$2,'{}'::jsonb)`,
      [user.id, requestId ?? null],
    );
    await client.query("COMMIT");
    return user;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    if (error && typeof error === "object" && "code" in error && error.code === "23505") {
      throw new AppError("ACCOUNT_EXISTS", "An account already exists for this email address.", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function updateCandidateProfile(userId: string, input: CandidateProfileInput, requestId?: string) {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query(
      `UPDATE users
       SET display_name=$2,headline=$3,location=$4,bio=$5,updated_at=now()
       WHERE id=$1 AND role='candidate' AND status='active'
       RETURNING id`,
      [userId, input.displayName, input.headline, input.location, input.bio],
    );
    if (!result.rows[0]) throw new AppError("ACCOUNT_UNAVAILABLE", "The Candidate account is unavailable.", 409);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','candidate.profile.update','user',$1::uuid::text,'updated',$2,$3::jsonb)`,
      [userId, requestId ?? null, JSON.stringify({ fields: ["displayName", "headline", "location", "bio"] })],
    );
    await client.query("COMMIT");
    return { updated: true as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function requestCandidatePasswordReset(input: ForgotPasswordInput, requestId?: string) {
  if (getRuntimeConfig().mail.status !== "configured") {
    throw new AppError("MAIL_NOT_CONFIGURED", "Password reset email is temporarily unavailable.", 503);
  }
  const userResult = await getPool().query<{ id: string; email: string }>(
    "SELECT id,email FROM users WHERE email=$1 AND role='candidate' AND status='active' LIMIT 1",
    [input.email],
  );
  const user = userResult.rows[0];
  if (!user) {
    await getPool().query(
      `INSERT INTO audit_events(actor_role,action,target_type,outcome,request_id,metadata)
       VALUES ('anonymous','auth.password_reset.request','user','accepted',$1,'{}'::jsonb)`,
      [requestId ?? null],
    );
    return { accepted: true as const };
  }

  const credential = createSessionCredential();
  const expiresAt = new Date(Date.now() + RESET_TTL_MS);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
    await client.query(
      "INSERT INTO password_reset_tokens(user_id,token_hash,expires_at) VALUES ($1,$2,$3)",
      [user.id, credential.tokenHash, expiresAt],
    );
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','auth.password_reset.request','user',$1::uuid::text,'accepted',$2,'{}'::jsonb)`,
      [user.id, requestId ?? null],
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }

  try {
    await sendPasswordResetEmail({
      to: user.email,
      resetUrl: publicAppUrl(`/reset-password/${credential.token}`),
      expiresAt,
    });
  } catch (error) {
    const code = error instanceof AppError ? error.code : "MAIL_SEND_FAILED";
    await getPool().query(
      `WITH invalidated AS (
         UPDATE password_reset_tokens SET used_at=now() WHERE token_hash=$1 AND used_at IS NULL RETURNING user_id
       )
       INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       SELECT user_id,'candidate','auth.password_reset.send','user',user_id::text,'failed',$2,jsonb_build_object('errorCode',$3::text) FROM invalidated`,
      [credential.tokenHash, requestId ?? null, code],
    );
  }
  return { accepted: true as const };
}

export async function resetCandidatePassword(input: ResetPasswordInput, requestId?: string) {
  const passwordHash = await hashPassword(input.password);
  const tokenHash = hashSessionToken(input.token);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; passwordHash: string }>(
      `SELECT user_account.id,user_account.password_hash AS "passwordHash"
       FROM password_reset_tokens reset_token
       JOIN users user_account ON user_account.id=reset_token.user_id
       WHERE reset_token.token_hash=$1 AND reset_token.used_at IS NULL AND reset_token.expires_at>now()
         AND user_account.role='candidate' AND user_account.status='active'
       FOR UPDATE OF reset_token,user_account`,
      [tokenHash],
    );
    const user = result.rows[0];
    if (!user) throw new AppError("PASSWORD_RESET_INVALID", "This password reset link is unavailable or expired.", 410);
    if (await verifyPassword(input.password, user.passwordHash)) {
      throw new AppError("PASSWORD_REUSE", "Choose a password different from the current password.", 409);
    }
    await client.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1", [user.id, passwordHash]);
    await client.query("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [user.id]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [user.id]);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','auth.password_reset.complete','user',$1::uuid::text,'updated',$2,'{}'::jsonb)`,
      [user.id, requestId ?? null],
    );
    await client.query("COMMIT");
    return { reset: true as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}

export async function changeCandidatePassword(userId: string, input: ChangePasswordInput, requestId?: string) {
  const current = await getPool().query<{ passwordHash: string }>(
    "SELECT password_hash AS \"passwordHash\" FROM users WHERE id=$1 AND role='candidate' AND status='active'",
    [userId],
  );
  if (!current.rows[0] || !(await verifyPassword(input.currentPassword, current.rows[0].passwordHash))) {
    throw new AppError("CURRENT_PASSWORD_INVALID", "The current password is incorrect.", 401);
  }
  if (await verifyPassword(input.newPassword, current.rows[0].passwordHash)) {
    throw new AppError("PASSWORD_REUSE", "Choose a password different from the current password.", 409);
  }
  const passwordHash = await hashPassword(input.newPassword);
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const locked = await client.query<{ passwordHash: string }>(
      "SELECT password_hash AS \"passwordHash\" FROM users WHERE id=$1 AND role='candidate' AND status='active' FOR UPDATE",
      [userId],
    );
    if (!locked.rows[0] || !(await verifyPassword(input.currentPassword, locked.rows[0].passwordHash))) {
      throw new AppError("CURRENT_PASSWORD_INVALID", "The current password is incorrect.", 401);
    }
    await client.query("UPDATE users SET password_hash=$2,updated_at=now() WHERE id=$1", [userId, passwordHash]);
    await client.query("UPDATE sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL", [userId]);
    await client.query("UPDATE password_reset_tokens SET used_at=now() WHERE user_id=$1 AND used_at IS NULL", [userId]);
    await client.query(
      `INSERT INTO audit_events(actor_id,actor_role,action,target_type,target_id,outcome,request_id,metadata)
       VALUES ($1,'candidate','auth.password_change','user',$1::uuid::text,'updated',$2,'{}'::jsonb)`,
      [userId, requestId ?? null],
    );
    await client.query("COMMIT");
    return { changed: true as const };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
