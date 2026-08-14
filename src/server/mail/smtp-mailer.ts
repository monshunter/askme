import "server-only";

import nodemailer from "nodemailer";

import { getRuntimeConfig } from "@/server/config";
import { AppError } from "@/server/errors";

export type SmtpTextEmail = {
  to: string;
  subject: string;
  text: string;
};

export async function sendSmtpTextEmail(input: SmtpTextEmail) {
  const config = getRuntimeConfig().mail;
  if (config.status !== "configured" || !config.host || !config.from) {
    throw new AppError("MAIL_NOT_CONFIGURED", "SMTP email delivery is not configured.", 503);
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
    await transporter.sendMail({ from: config.from, ...input });
  } catch {
    throw new AppError("MAIL_SEND_FAILED", "SMTP email delivery failed.", 502);
  } finally {
    transporter.close();
  }
}
