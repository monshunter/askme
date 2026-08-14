import "server-only";

import { sendSmtpTextEmail } from "@/server/mail/smtp-mailer";

export async function sendPasswordResetEmail(input: { to: string; resetUrl: string; expiresAt: Date }) {
  await sendSmtpTextEmail({
    to: input.to,
    subject: "Reset your Askme password",
    text: [
      "A password reset was requested for your Askme Candidate account.",
      `Use this one-time link before ${input.expiresAt.toISOString()}:`,
      input.resetUrl,
      "",
      "If you did not request this change, ignore this email. Your current password remains active.",
    ].join("\n"),
  });
}
