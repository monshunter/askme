import { KnowledgeClient } from "@/components/candidate/knowledge-client";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";
import { listKnowledge } from "@/server/knowledge/knowledge-service";

export default async function KnowledgePage({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const user = await requirePageUser("candidate");
  const { search } = await searchParams;
  const query = { page: 1, pageSize: 20, status: "active" as const, sort: "updated" as const, ...(search?.trim() ? { search: search.trim().slice(0, 200) } : {}) };
  const [knowledge, locale] = await Promise.all([listKnowledge(user.id, query), getRequestLocale()]);
  return <KnowledgeClient initialKnowledge={JSON.parse(JSON.stringify(knowledge))} initialSearch={query.search ?? ""} locale={locale} />;
}
