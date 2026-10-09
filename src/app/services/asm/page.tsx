import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import { ServiceInventoryPage, type InventoryColumn } from "@/app/services/_components/service-inventory";
import { ResourceIdentity } from "@/components/console-ui";
import { listAsmMeshes, type AsmMesh, withCloudResult } from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";

export const metadata: Metadata = { title: "ASM | Huawei Cloud Better UI" };
const columns: InventoryColumn<AsmMesh>[] = [
  { header: "Mesh", render: mesh => <ResourceIdentity id={mesh.id} name={mesh.name} description={mesh.type} /> },
  { header: "Phase", render: mesh => mesh.status },
  { header: "Version", render: mesh => mesh.version },
  { header: "Clusters", render: mesh => mesh.clusterCount },
  { header: "Project", render: mesh => mesh.projectName },
];
export default async function AsmPage() {
  const result = await withCloudResult<AsmMesh[]>([], listAsmMeshes, cloudCacheKeys.listAsmMeshes);
  const meshes = result.data;
  return <ServiceInventoryPage managementService="asm" actionLabel="Create mesh" actionTitle="Create a mesh" active="Containers" backHref="/services" backLabel="Back to services" columns={columns} description="Service meshes with their native phase, version, and member-cluster count." empty="No meshes were returned for the selected projects." icon={Boxes} result={result} rows={meshes} stats={[{ label: "Meshes", value: meshes.length }, { label: "Running", value: meshes.filter(mesh => mesh.status === "Running").length }, { label: "Member clusters", value: meshes.reduce((count, mesh) => count + mesh.clusterCount, 0) }]} tableTitle="Mesh inventory" title="Application Service Mesh" />;
}
