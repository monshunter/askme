import { describe, expect, it } from "vitest";

import { DEFAULT_LOCALE, LOCALE_COOKIE, localeCookieOptions, normalizeLocale, translate } from "./core";

describe("locale core", () => {
  it("accepts only supported locale values and defaults to English", () => {
    expect(normalizeLocale("en")).toBe("en");
    expect(normalizeLocale("zh-CN")).toBe("zh-CN");
    expect(normalizeLocale("zh")).toBe(DEFAULT_LOCALE);
    expect(normalizeLocale(undefined)).toBe(DEFAULT_LOCALE);
  });

  it("translates typed shared copy and interpolates parameters", () => {
    expect(translate("en", "language.chinese")).toBe("简体中文");
    expect(translate("zh-CN", "language.current")).toBe("当前语言");
    expect(translate("en", "shared.welcome", { name: "Taylor" })).toBe("Welcome, Taylor.");
    expect(translate("zh-CN", "shared.welcome", { name: "Taylor" })).toBe("欢迎，Taylor。");
    expect(translate("zh-CN", "admin.overview.copy", { name: "Platform Admin" })).toContain("Platform Admin");
    expect(translate("zh-CN", "public.rateLimited", { seconds: 30 })).toContain("30");
    expect(translate("zh-CN", "invite.unavailable")).toBe("邀请不可用");
  });

  it("uses the consolidated Candidate Agent navigation name", () => {
    expect(translate("en", "candidate.nav.agent")).toBe("Agent");
    expect(translate("zh-CN", "candidate.nav.agent")).toBe("智能体");
    expect(translate("en", "agent.title")).toBe("Agent");
    expect(translate("zh-CN", "agent.title")).toBe("智能体");
  });

  it("defines a one-year same-site cookie contract", () => {
    expect(LOCALE_COOKIE).toBe("askme_locale");
    expect(localeCookieOptions(false)).toMatchObject({ httpOnly: true, maxAge: 31_536_000, path: "/", sameSite: "lax", secure: false });
    expect(localeCookieOptions(true)).toMatchObject({ httpOnly: true, maxAge: 31_536_000, path: "/", sameSite: "lax", secure: true });
  });
});
