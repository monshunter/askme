"use client";

import { usePathname } from "next/navigation";

import { type Locale } from "@/i18n/core";

import { LanguageSwitcher } from "./language-switcher";

export function GlobalLanguageControl({ locale }: { locale: Locale }) {
  const pathname = usePathname();
  if (pathname.startsWith("/a/")) return null;

  return <div className="global-language-control"><LanguageSwitcher locale={locale} /></div>;
}
