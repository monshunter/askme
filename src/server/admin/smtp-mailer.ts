import "server-only";

import nodemailer from "nodemailer";

import { getRuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

export async function sendAdminInvitationEmail(input: { to: string; displayName: string; invitationUrl: string; expiresAt: Date }) {
  const config = getRuntimeConfig().mail;
  if (config.status !== "configured" || !config.host || !config.from) {
    throw new AppError("MAIL_NOT_CONFIGURED", "Admin invitations are unavailable until SMTP is configured.", 409);
  }
  const transporter = nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: config.user && config.password ? { user: config.user, pass: config.password } : undefined,
    connectionTimeout: 10_000,
    greetingTimeout: 10_000,
    socketTimeout: 20_000,
  });
  try {
    await transporter.sendMail({
      from: config.from,
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
  } catch {
    throw new AppError("MAIL_SEND_FAILED", "The invitation email could not be sent. Check the SMTP capability and try again.", 502);
  } finally {
    transporter.close();
  }
}
