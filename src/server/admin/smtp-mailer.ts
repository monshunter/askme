import "server-only";

import { sendSmtpTextEmail } from "@/server/mail/smtp-mailer";

export async function sendAdminInvitationEmail(input: { to: string; displayName: string; invitationUrl: string; expiresAt: Date }) {
  await sendSmtpTextEmail({
    to: input.to,
    subject: "You are invited to administer Askme",
    text: [
      `Hello ${input.displayName},`,
      "",
      "A Platform Admin invited you to manage Askme.",
      `Accept the one-time invitation before ${input.expiresAt.toISOString()}:`,
      input.invitationUrl,
      "",
      "If you did not expect this invitation, ignore this email.",
    ].join("\n"),
  });
}
