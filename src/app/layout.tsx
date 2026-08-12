import type { Metadata } from "next";

import { LanguageSwitcher } from "@/components/language-switcher";
import { getRequestLocale } from "@/i18n/server";

import "./globals.css";

export const metadata: Metadata = {
  title: "Askme — Personal Career Knowledge Agent",
  description: "Don't browse my resume. Ask my Agent.",
};

export default async function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  const locale = await getRequestLocale();
  return (
    <html lang={locale}>
      <body>
        <div className="global-language-control">
          <LanguageSwitcher locale={locale} />
        </div>
        {children}
      </body>
    </html>
  );
}
