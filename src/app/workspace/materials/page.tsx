import { MaterialsClient } from "@/components/candidate/materials-client";
import { requirePageUser } from "@/server/auth/current";
import { listMaterials } from "@/server/materials/material-service";

export default async function MaterialsPage() {
  const user = await requirePageUser("candidate");
  const materials = await listMaterials(user.id, { page: 1, pageSize: 20, sort: "newest" });
  return <MaterialsClient initialMaterials={JSON.parse(JSON.stringify(materials))} />;
}
