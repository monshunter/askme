import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  close: vi.fn(),
  sendMail: vi.fn(),
  createTransport: vi.fn(),
  getRuntimeConfig: vi.fn(),
}));

vi.mock("nodemailer", () => ({ default: { createTransport: mocks.createTransport } }));
vi.mock("@/server/config", () => ({ getRuntimeConfig: mocks.getRuntimeConfig }));
vi.mock("server-only", () => ({}));

import { sendSmtpTextEmail } from "./smtp-mailer";

describe("shared SMTP mailer", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.createTransport.mockReturnValue({ sendMail: mocks.sendMail, close: mocks.close });
    mocks.sendMail.mockResolvedValue({ messageId: "local-message" });
    mocks.getRuntimeConfig.mockReturnValue({
      mail: {
        status: "configured",
        host: "smtp.example.test",
        port: 465,
        secure: true,
        user: "mailer",
        password: "secret",
        from: "Askme <noreply@example.test>",
      },
    });
  });

  it("owns SMTP connection, authentication, timeouts and transport closing", async () => {
    await sendSmtpTextEmail({ to: "candidate@example.test", subject: "Reset", text: "Safe body" });

    expect(mocks.createTransport).toHaveBeenCalledWith({
      host: "smtp.example.test",
      port: 465,
      secure: true,
      auth: { user: "mailer", pass: "secret" },
      connectionTimeout: 10_000,
      greetingTimeout: 10_000,
      socketTimeout: 20_000,
    });
    expect(mocks.sendMail).toHaveBeenCalledWith({
      from: "Askme <noreply@example.test>",
      to: "candidate@example.test",
      subject: "Reset",
      text: "Safe body",
    });
    expect(mocks.close).toHaveBeenCalledOnce();
  });

  it("supports an unauthenticated local SMTP relay", async () => {
    mocks.getRuntimeConfig.mockReturnValue({
      mail: { status: "configured", host: "mailpit", port: 1025, secure: false, user: null, password: null, from: "Askme <noreply@askme.local>" },
    });

    await sendSmtpTextEmail({ to: "candidate@askme.local", subject: "Local", text: "Mailpit" });

    expect(mocks.createTransport).toHaveBeenCalledWith(expect.objectContaining({ host: "mailpit", port: 1025, secure: false, auth: undefined }));
  });

  it("maps missing configuration and send failures without exposing Provider errors", async () => {
    mocks.getRuntimeConfig.mockReturnValue({ mail: { status: "not_configured", host: null, from: null } });
    await expect(sendSmtpTextEmail({ to: "candidate@example.test", subject: "Reset", text: "Body" })).rejects.toMatchObject({ code: "MAIL_NOT_CONFIGURED", status: 503 });
    expect(mocks.createTransport).not.toHaveBeenCalled();

    mocks.getRuntimeConfig.mockReturnValue({
      mail: { status: "configured", host: "smtp.example.test", port: 587, secure: false, user: null, password: null, from: "Askme <noreply@example.test>" },
    });
    mocks.sendMail.mockRejectedValue(new Error("provider detail that must stay private"));
    await expect(sendSmtpTextEmail({ to: "candidate@example.test", subject: "Reset", text: "Body" })).rejects.toMatchObject({ code: "MAIL_SEND_FAILED", status: 502 });
    expect(mocks.close).toHaveBeenCalledOnce();
  });
});
