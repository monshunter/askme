import { Bot, FileSearch, Search, UsersRound } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

import { createTranslator } from "@/i18n/core";
import { getRequestLocale } from "@/i18n/server";
import { searchAdminWorkspace } from "@/server/admin/search-service";

export const dynamic = "force-dynamic";

export default async function AdminSearchPage({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const query = ((await searchParams).q ?? "").trim().slice(0, 120);
  const [results, locale] = await Promise.all([query.length >= 2 ? searchAdminWorkspace(query) : null, getRequestLocale()]);
  const t = createTranslator(locale);
  const total = results ? results.candidates.length + results.agents.length + results.reviews.length : 0;
  return <div className="admin-page"><section className="admin-hero compact"><p className="page-kicker">{t("admin.search.kicker")}</p><h1>{t("admin.search.title")} <span className="title-seal" aria-hidden="true">职问</span></h1><p>{t("admin.search.copy")}</p></section><form className="admin-search-page-form" action="/admin/search"><Search size={20} /><label className="sr-only" htmlFor="admin-search-page">{t("admin.search.pageLabel")}</label><input id="admin-search-page" name="q" defaultValue={query} minLength={2} maxLength={120} required autoFocus placeholder={t("admin.search.pagePlaceholder")} /><button>{t("shared.search")}</button></form>{query.length > 0 && query.length < 2 ? <div className="inline-feedback error">{t("admin.search.minimum")}</div> : null}{results ? <><p className="admin-search-summary">{t("admin.search.summary", { count: total, query })}</p><div className="admin-search-results"><SearchGroup title={t("admin.candidates.title")} icon={UsersRound} empty={t("admin.search.candidatesEmpty")}>{results.candidates.map((candidate) => <Link href={`/admin/candidates?search=${encodeURIComponent(candidate.displayName as string)}`} key={candidate.id as string}><strong>{candidate.displayName as string}</strong><small>{candidate.email as string} · {candidate.status as string}</small></Link>)}</SearchGroup><SearchGroup title={t("admin.agents.title")} icon={Bot} empty={t("admin.search.agentsEmpty")}>{results.agents.map((agent) => <Link href={`/admin/agents?search=${encodeURIComponent(agent.slug as string)}`} key={agent.id as string}><strong>{agent.displayName as string}</strong><small>{agent.headline as string || agent.slug as string} · {agent.status as string}</small></Link>)}</SearchGroup><SearchGroup title={t("admin.search.reviews")} icon={FileSearch} empty={t("admin.search.reviewsEmpty")}>{results.reviews.map((review) => <Link href={`/admin/reviews?search=${encodeURIComponent(review.category as string)}`} key={review.id as string}><strong>{String(review.category).replaceAll("_", " ")}</strong><small>{review.safeSummary as string}</small></Link>)}</SearchGroup></div></> : <div className="admin-empty large"><Search size={31} /><h2>{t("admin.search.empty")}</h2><p>{t("admin.search.emptyCopy")}</p></div>}</div>;
}

function SearchGroup({ title, icon: Icon, empty, children }: { title: string; icon: typeof UsersRound; empty: string; children: ReactNode }) { const hasResults = Array.isArray(children) ? children.length > 0 : Boolean(children); return <section className="admin-card admin-search-group"><header><Icon size={20} /><h2>{title}</h2></header>{hasResults ? <div>{children}</div> : <p>{empty}</p>}</section>; }
