import { RepositoriesClient } from "@/components/candidate/repositories-client";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";
import { listCandidateRepositories } from "@/server/repositories/repository-service";

export default async function RepositoriesPage() {
  const user = await requirePageUser("candidate");
  const [repositories, locale] = await Promise.all([listCandidateRepositories(user.id), getRequestLocale()]);
  return <RepositoriesClient initialRepositories={JSON.parse(JSON.stringify(repositories.items))} locale={locale} />;
}
