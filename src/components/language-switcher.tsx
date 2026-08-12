"use client";

import { Globe2, LoaderCircle } from "lucide-react";
import { useRouter } from "next/navigation";
import { useId, useState } from "react";

import { type Locale, translate } from "@/i18n/core";

export function LanguageSwitcher({ locale }: { locale: Locale }) {
  const id = useId();
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function changeLocale(nextLocale: Locale) {
    if (nextLocale === locale || pending) return;
    setPending(true);
    setError(null);
    try {
      const response = await fetch("/api/preferences/locale", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ locale: nextLocale }),
      });
      if (!response.ok) throw new Error("locale update failed");
      router.refresh();
    } catch {
      setError(translate(locale, "language.saveError"));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="language-switcher">
      {pending ? <LoaderCircle className="spin" size={14} aria-hidden="true" /> : <Globe2 size={14} aria-hidden="true" />}
      <label className="sr-only" htmlFor={id}>{translate(locale, "language.switch")}</label>
      <select id={id} value={locale} disabled={pending} onChange={(event) => void changeLocale(event.target.value as Locale)}>
        <option value="en">{translate(locale, "language.english")}</option>
        <option value="zh-CN">{translate(locale, "language.chinese")}</option>
      </select>
      <span className="sr-only" role="status">{pending ? translate(locale, "language.switching") : ""}</span>
      {error ? <span className="language-switch-error" role="alert">{error}</span> : null}
    </div>
  );
}
