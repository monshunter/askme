import { MaterialsClient } from "@/components/candidate/materials-client";
import { getRequestLocale } from "@/i18n/server";
import { requirePageUser } from "@/server/auth/current";
import { listMaterials } from "@/server/materials/material-service";

export default async function MaterialsPage() {
  const user = await requirePageUser("candidate");
  const [materials, locale] = await Promise.all([listMaterials(user.id, { page: 1, pageSize: 20, sort: "newest" }), getRequestLocale()]);
  return <MaterialsClient initialMaterials={JSON.parse(JSON.stringify(materials))} locale={locale} />;
}
