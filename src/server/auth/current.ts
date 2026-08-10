import "server-only";

import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { NextRequest } from "next/server";

import { AppError } from "@/server/errors";

import { assertRole, resolveSessionToken, SESSION_COOKIE, type AuthenticatedUser } from "./service";

export async function currentPageUser() {
  const store = await cookies();
  return resolveSessionToken(store.get(SESSION_COOKIE)?.value);
}

export async function requirePageUser(role: AuthenticatedUser["role"]) {
  const user = await currentPageUser();
  if (!user) redirect("/login");
  if (user.role !== role) redirect(user.role === "admin" ? "/admin" : "/workspace");
  return user;
}

export async function requireRequestUser(request: NextRequest, roles: AuthenticatedUser["role"][]) {
  const user = await resolveSessionToken(request.cookies.get(SESSION_COOKIE)?.value);
  if (!user) throw new AppError("UNAUTHENTICATED", "Authentication is required.", 401);
  return assertRole(user, roles);
}
