import { z } from "zod";

import { AppError } from "@/server/errors";

const email = z.string().trim().pipe(z.email().max(320)).transform((value) => value.toLocaleLowerCase());
const password = z.string().min(12).max(200);

const registrationSchema = z.object({
  email,
  displayName: z.string().trim().min(1).max(120),
  password,
  confirmPassword: z.string().max(200).optional(),
}).strip().refine((value) => value.confirmPassword === undefined || value.confirmPassword === value.password)
  .transform((value) => ({ email: value.email, displayName: value.displayName, password: value.password }));

const forgotPasswordSchema = z.object({ email }).strip();
const resetPasswordSchema = z.object({
  token: z.string().regex(/^[A-Za-z0-9_-]{43}$/),
  password,
  confirmPassword: z.string().max(200).optional(),
}).strip().refine((value) => value.confirmPassword === undefined || value.confirmPassword === value.password)
  .transform((value) => ({ token: value.token, password: value.password }));
const changePasswordSchema = z.object({
  currentPassword: z.string().min(1).max(200),
  newPassword: password,
  confirmPassword: z.string().max(200).optional(),
}).strip().refine((value) => value.confirmPassword === undefined || value.confirmPassword === value.newPassword)
  .transform((value) => ({ currentPassword: value.currentPassword, newPassword: value.newPassword }));

function parse<T>(schema: z.ZodType<T>, value: unknown, code: string, message: string) {
  const result = schema.safeParse(value);
  if (!result.success) throw new AppError(code, message, 400);
  return result.data;
}

export function parseRegistrationInput(value: unknown) {
  return parse(registrationSchema, value, "INVALID_REGISTRATION_INPUT", "Enter a valid name, email, and password of at least 12 characters.");
}

export function parseForgotPasswordInput(value: unknown) {
  return parse(forgotPasswordSchema, value, "INVALID_FORGOT_PASSWORD_INPUT", "Enter a valid email address.");
}

export function parseResetPasswordInput(value: unknown) {
  return parse(resetPasswordSchema, value, "INVALID_PASSWORD_RESET_INPUT", "Use a valid reset link and a password of at least 12 characters.");
}

export function parseChangePasswordInput(value: unknown) {
  return parse(changePasswordSchema, value, "INVALID_PASSWORD_CHANGE_INPUT", "Enter the current password and a new password of at least 12 characters.");
}

export type RegistrationInput = ReturnType<typeof parseRegistrationInput>;
export type ForgotPasswordInput = ReturnType<typeof parseForgotPasswordInput>;
export type ResetPasswordInput = ReturnType<typeof parseResetPasswordInput>;
export type ChangePasswordInput = ReturnType<typeof parseChangePasswordInput>;
