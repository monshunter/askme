import type { Metadata } from "next";

import { GlobalLanguageControl } from "@/components/global-language-control";
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
        <GlobalLanguageControl locale={locale} />
        {children}
      </body>
    </html>
  );
}
