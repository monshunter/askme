import { ShieldX } from "lucide-react";
import Link from "next/link";

import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";

export default async function PublicAgentNotFound() {
  const t = createTranslator(await getRequestLocale());
  return <main className="public-unavailable"><Link className="public-wordmark" href="/">Askme <span aria-hidden="true">问候</span></Link><section><span><ShieldX size={34} /></span><h1>{t("public.unavailable.title")}</h1><p>{t("public.unavailable.link")}</p><Link href="/">{t("public.return")}</Link></section></main>;
}
