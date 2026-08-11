import { ReviewsClient } from "@/components/admin/reviews-client";
import { getRequestLocale } from "@/i18n/server";
import { parseReviewListQuery } from "@/server/admin/admin-input";
import { listContentReviews } from "@/server/admin/review-service";

export const dynamic = "force-dynamic";

export default async function ReviewsPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) { const raw = await searchParams; const parameters = new URLSearchParams(); for (const [key, value] of Object.entries(raw)) if (typeof value === "string") parameters.set(key, value); const query = parseReviewListQuery(parameters); const [data, locale] = await Promise.all([listContentReviews(query), getRequestLocale()]); return <ReviewsClient initialPage={JSON.parse(JSON.stringify(data))} initialFilters={query} locale={locale} />; }
