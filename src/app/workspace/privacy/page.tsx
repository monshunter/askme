import { PrivacyClient } from "@/components/candidate/privacy-client";
import { requirePageUser } from "@/server/auth/current";
import { getPrivacyOverview } from "@/server/privacy/privacy-service";

export default async function PrivacyPage() {
  const user = await requirePageUser("candidate");
  const overview = await getPrivacyOverview(user.id, { page: 1, pageSize: 20, sort: "newest" });
  return <PrivacyClient initialOverview={JSON.parse(JSON.stringify(overview))} />;
}
