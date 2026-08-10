import type { Metadata } from "next";

import "./globals.css";

export const metadata: Metadata = {
  title: "Askme — Personal Career Knowledge Agent",
  description: "Don't browse my resume. Ask my Agent.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
