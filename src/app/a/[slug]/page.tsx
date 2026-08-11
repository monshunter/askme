import { notFound } from "next/navigation";

import { PublicAgentClient } from "@/components/public/public-agent-client";
import { getRequestLocale } from "@/i18n/server";
import { AppError } from "@/server/errors";
import { loadPublicAgentBySlug } from "@/server/publication/public-agent-service";

async function loadAgentOrNotFound(slug: string) {
  try {
    return await loadPublicAgentBySlug(slug);
  } catch (error) {
    if (error instanceof AppError && error.code === "PUBLIC_AGENT_UNAVAILABLE") notFound();
    throw error;
  }
}

export default async function PublicAgentPage({ params }: { params: Promise<{ slug: string }> }) {
  const { slug } = await params;
  const [projection, locale] = await Promise.all([loadAgentOrNotFound(slug), getRequestLocale()]);
  return <PublicAgentClient slug={slug} initialProjection={JSON.parse(JSON.stringify(projection))} locale={locale} />;
}
