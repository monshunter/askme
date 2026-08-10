import "server-only";

import { and, eq, gt, isNull } from "drizzle-orm";

import { getDb } from "@/server/db/client";
import { auditEvents, sessions, users } from "@/server/db/schema";
import { AppError } from "@/server/errors";

import { createSessionCredential, hashSessionToken, verifyPassword } from "./crypto";

export const SESSION_COOKIE = "askme_session";
const SESSION_DURATION_MS = 7 * 24 * 60 * 60 * 1000;

export type AuthenticatedUser = {
  id: string;
  email: string;
  role: "candidate" | "admin";
  locale: string;
  displayName: string;
  headline: string | null;
  location: string | null;
  bio: string | null;
  avatarUrl: string | null;
};

const publicUserSelection = {
  id: users.id,
  email: users.email,
  role: users.role,
  locale: users.locale,
  displayName: users.displayName,
  headline: users.headline,
  location: users.location,
  bio: users.bio,
  avatarUrl: users.avatarUrl,
};

export async function authenticate(email: string, password: string) {
  const db = getDb();
  const [record] = await db
    .select({ ...publicUserSelection, passwordHash: users.passwordHash, status: users.status })
    .from(users)
    .where(eq(users.email, email.trim().toLowerCase()))
    .limit(1);

  if (!record || !(await verifyPassword(password, record.passwordHash))) {
    throw new AppError("INVALID_CREDENTIALS", "The email or password is incorrect.", 401);
  }
  if (record.status !== "active") {
    throw new AppError("ACCOUNT_SUSPENDED", "This account is suspended.", 403);
  }

  const { passwordHash: _passwordHash, status: _status, ...user } = record;
  void _passwordHash;
  void _status;
  return user;
}

export async function createSession(user: AuthenticatedUser, requestId?: string) {
  const db = getDb();
  const credential = createSessionCredential();
  const expiresAt = new Date(Date.now() + SESSION_DURATION_MS);
  await db.transaction(async (transaction) => {
    await transaction.insert(sessions).values({ userId: user.id, tokenHash: credential.tokenHash, expiresAt });
    await transaction.insert(auditEvents).values({
      actorId: user.id,
      actorRole: user.role,
      action: "auth.login",
      targetType: "session",
      outcome: "success",
      requestId,
    });
  });
  return { token: credential.token, expiresAt };
}

export async function resolveSessionToken(token: string | undefined): Promise<AuthenticatedUser | null> {
  if (!token) return null;
  const db = getDb();
  const [record] = await db
    .select(publicUserSelection)
    .from(sessions)
    .innerJoin(users, eq(sessions.userId, users.id))
    .where(
      and(
        eq(sessions.tokenHash, hashSessionToken(token)),
        isNull(sessions.revokedAt),
        gt(sessions.expiresAt, new Date()),
        eq(users.status, "active"),
      ),
    )
    .limit(1);
  return record ?? null;
}

export async function revokeSession(token: string | undefined, id?: string) {
  if (!token) return;
  const db = getDb();
  const tokenHash = hashSessionToken(token);
  const [session] = await db.select({ userId: sessions.userId }).from(sessions).where(eq(sessions.tokenHash, tokenHash)).limit(1);
  await db.transaction(async (transaction) => {
    await transaction.update(sessions).set({ revokedAt: new Date() }).where(eq(sessions.tokenHash, tokenHash));
    if (session) {
      await transaction.insert(auditEvents).values({
        actorId: session.userId,
        actorRole: "authenticated",
        action: "auth.logout",
        targetType: "session",
        outcome: "success",
        requestId: id,
      });
    }
  });
}

export function sessionCookieOptions(expiresAt: Date) {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_LOCAL_COOKIE !== "true",
    path: "/",
    expires: expiresAt,
  };
}

export function assertRole(user: AuthenticatedUser, roles: AuthenticatedUser["role"][]) {
  if (!roles.includes(user.role)) throw new AppError("FORBIDDEN", "You do not have permission to perform this action.", 403);
  return user;
}
