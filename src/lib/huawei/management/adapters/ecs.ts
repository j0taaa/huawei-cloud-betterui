import "server-only";
import type { BetterUiSession } from "@/lib/auth-session";
import { ManagementInputError, type ManagementChoice, type ManagementResource } from "@/lib/management-contract";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listEcsInstancesForProject, runEcsAction } from "@/lib/huawei/services/ecs";
import { listImagesForProject } from "@/lib/huawei/services/ims";
import { listSubnetsForProject, listSecurityGroupsForProject } from "@/lib/huawei/services/vpc";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { ManagementAdapter } from "../types";

const name = { key: "name", label: "Server name", required: true, min: 1, max: 64, pattern: "^[A-Za-z0-9_\\-\\p{L}.]{1,64}$" };
const description = { key: "description", label: "Description", type: "textarea" as const, max: 512 };
const flavorField = { key: "flavor", label: "Compute flavor", type: "select" as const, source: "flavors", required: true };
async function flavors(session: BetterUiSession, resource?: ManagementResource) {
  const body = await huaweiList<Record<string, unknown>>(session, "ecs", `/v1/${session.projectId}/cloudservers/${resource ? "resize_flavors" : "flavors"}?limit=100${resource ? `&instance_uuid=${encodeURIComponent(resource.id)}` : ""}`, { items: ["flavors"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "id" });
  return asArray(body.flavors).map(asRecord).filter((item) => item["os-flavor-access:is_public"] !== false && asRecord(item.extra_specs)["ecs:performancetype"] !== "baremetal");
}
const flavorChoices = (items: Record<string, unknown>[]) => items.map((item) => ({ value: String(item.id), label: `${item.name} · ${item.vcpus} vCPU · ${Number(item.ram) / 1024} GB RAM` }));

export const ecsManagement: ManagementAdapter = {
  title: "Elastic Cloud Server",
  operations: [
    { id: "create", label: "Create server", kind: "create", description: "Create one pay-per-use server with a private network and an existing image. Public IPs and additional disks can be attached separately.", impact: "The selected compute and system disk are billed while the server exists.", fields: [name, description, flavorField,
      { key: "image", label: "System image", type: "select", source: "images", required: true },
      { key: "subnet", label: "Subnet", type: "select", source: "subnets", required: true, help: "The selected subnet determines the VPC." },
      { key: "securityGroups", label: "Security groups", type: "list", source: "securityGroups", required: true, max: 5 },
      { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true },
      { key: "diskType", label: "System disk type", type: "select", required: true, defaultValue: "SSD", choices: ["SSD", "SAS", "GPSSD", "ESSD", "GPSSD2", "ESSD2"].map((value) => ({ value, label: value })) },
      { key: "diskSize", label: "System disk capacity (GB)", type: "number", required: true, min: 40, max: 1024, defaultValue: 40 },
      { key: "authentication", label: "Login method", type: "select", required: true, defaultValue: "key", choices: [{ value: "key", label: "SSH key" }, { value: "password", label: "Password" }] },
      { key: "key", label: "SSH key", type: "select", source: "keys" },
      { key: "password", label: "Initial administrator password", type: "password", min: 8, max: 26, help: "Required for password login. Include at least three character groups." },
      { key: "enterpriseProjectId", label: "Enterprise project ID", max: 64, defaultValue: "0" },
    ] },
    { id: "update", label: "Edit server", kind: "update", description: "Change server name and description.", fields: [name, description] },
    { id: "start", label: "Start server", kind: "action", description: "Start a stopped server.", fields: [], allowedStatuses: ["SHUTOFF"], impact: "Compute billing resumes according to the server's pricing plan." },
    { id: "stop", label: "Stop server", kind: "action", description: "Gracefully stop the operating system.", fields: [], allowedStatuses: ["ACTIVE"], confirmation: true, impact: "Applications on this server stop. Attached storage and other resources may continue to incur charges." },
    { id: "restart", label: "Restart server", kind: "action", description: "Gracefully restart the operating system.", fields: [], allowedStatuses: ["ACTIVE"], confirmation: true, impact: "Applications are temporarily unavailable during the restart." },
    { id: "resize", label: "Change compute flavor", kind: "action", description: "Change the compute specification of a stopped pay-per-use server.", fields: [flavorField], allowedStatuses: ["SHUTOFF"], confirmation: true, impact: "The new flavor changes compute pricing. Verify image, architecture, disk, and network compatibility before submitting." },
    { id: "delete", label: "Delete server", kind: "delete", description: "Delete the server, with explicit control over attached disks and public IPs. Back up data before deleting.", fields: [{ key: "deleteVolumes", label: "Delete attached disks", type: "boolean", defaultValue: false }, { key: "deletePublicIp", label: "Release public IP", type: "boolean", defaultValue: false }], confirmation: true, impact: "The server is permanently removed. Selecting disk deletion permanently removes the selected server's attached disk data. Retained disks and IPs continue to incur charges." },
  ],
  inventory: async (session) => (await listEcsInstancesForProject(session)).map((item) => ({ id: item.id, name: item.name, status: item.status, values: { name: item.name, description: item.description === "-" ? "" : item.description, flavor: item.flavorId, chargingMode: item.chargingMode, projectId: item.projectId } })),
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "resize") return resource ? { flavors: flavorChoices(await flavors(session, resource)) } : { flavors: [] };
    if (operation !== "create") return {};
    const [products, images, subnets, groups, zones, keys] = await Promise.all([
      flavors(session), listImagesForProject(session), listSubnetsForProject(session), listSecurityGroupsForProject(session),
      huaweiFetch<Record<string, unknown>>(session, "ecs", `/v2.1/${session.projectId}/os-availability-zone`),
      huaweiList<Record<string, unknown>>(session, "ecs", `/v2.1/${session.projectId}/os-keypairs?limit=100`, { items: ["keypairs"], kind: "marker", parameter: "marker", size: 100, fallbackKey: "keypair.name" }),
    ]);
    return { flavors: flavorChoices(products), images: images.filter((image) => image.status.toLowerCase() === "active" && !image.isWholeImage).map((image) => ({ value: image.id, label: `${image.name} · ${image.osType} · min ${image.rawMinDiskGb} GB` })), subnets: subnets.map((subnet) => ({ value: subnet.id, label: `${subnet.name} · ${subnet.cidr} · ${subnet.vpcId}` })), securityGroups: groups.map((group) => ({ value: group.id, label: group.name })), zones: asArray(zones.availabilityZoneInfo).map(asRecord).filter((zone) => asRecord(zone.zoneState).available === true).map((zone) => ({ value: String(zone.zoneName), label: String(zone.zoneName) })), keys: asArray(keys.keypairs).map((raw) => asRecord(asRecord(raw).keypair)).map((key) => ({ value: String(key.name), label: String(key.name) })) };
  },
  poll: async (session, entry) => {
    const job = await huaweiFetch<Record<string, unknown>>(session, "ecs", `/v1/${session.projectId}/jobs/${encodeURIComponent(entry.jobId!)}`);
    const state = job.status === "SUCCESS" ? "succeeded" : job.status === "FAIL" ? "failed" : "submitted";
    const entities = asRecord(job.entities);
    const server = asRecord(asArray(entities.sub_jobs)[0]);
    return { state, message: state === "failed" ? "The cloud job failed. Check the resource state and native task details before retrying." : state === "succeeded" ? "The cloud job completed successfully." : "The cloud job is still processing.", resourceId: firstString([asRecord(server.entities).server_id, entities.server_id], "") || undefined };
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listEcsInstances, cloudCacheKeys.listEvsDisks, cloudCacheKeys.listEips, cloudCacheKeys.summary, ...(resource ? [cloudCacheKeys.ecs(resource.id), cloudCacheKeys.ecsMonitoring(resource.id), cloudCacheKeys.ecsSnapshots(resource.id)] : [])],
  execute: async (session, operation, values, resource) => {
    const base = `/v1/${session.projectId}/cloudservers`;
    let response: Record<string, unknown>;
    if (operation === "create") {
      const [images, subnets, products] = await Promise.all([listImagesForProject(session), listSubnetsForProject(session), flavors(session)]);
      const image = images.find((image) => image.id === values.image);
      const subnet = subnets.find((subnet) => subnet.id === values.subnet);
      const flavor = products.find((flavor) => flavor.id === values.flavor);
      if (!image || !subnet || !flavor) throw new ManagementInputError("The selected image, flavor, or subnet is no longer available.");
      if (Number(values.diskSize) < image.rawMinDiskGb || Number(flavor.ram) < image.rawMinRamMb) throw new ManagementInputError("The image requires a larger disk or more memory than the selected configuration.");
      const azProducts = await huaweiFetch<Record<string, unknown>>(session, "ecs", `${base}/flavors?${new URLSearchParams({ flavor_id: String(values.flavor), availability_zone: String(values.zone) })}`);
      if (!asArray(azProducts.flavors).some((raw) => asRecord(raw).id === values.flavor && asRecord(asRecord(raw).extra_specs)["ecs:status"] !== "abandon")) throw new ManagementInputError("The selected flavor is unavailable in this availability zone.");
      if (values.authentication === "key" && !values.key) throw new ManagementInputError("Select an SSH key for key-based login.");
      if (values.authentication === "key" && image.osType.toLowerCase() === "windows") throw new ManagementInputError("Choose password login for this Windows image.");
      if (values.authentication === "password") {
        const secret = String(values.password ?? "");
        if (secret.length < 8 || [/[a-z]/, /[A-Z]/, /[0-9]/, /[!@$%^\-_\=+[\]{}:,./?]/].filter((group) => group.test(secret)).length < 3 || /root|toor|administrator|rotartsinimda/i.test(secret)) throw new ManagementInputError("The administrator password does not meet ECS complexity requirements.");
      }
      response = await huaweiFetch(session, "ecs", base, { method: "POST", body: JSON.stringify({ server: { name: values.name, description: values.description ?? "", flavorRef: values.flavor, imageRef: values.image, availability_zone: values.zone, count: 1, vpcid: subnet.vpcId, nics: [{ subnet_id: subnet.neutronNetworkId || subnet.id }], security_groups: (values.securityGroups as string[]).map((id) => ({ id })), root_volume: { volumetype: values.diskType, size: values.diskSize }, extendparam: { chargingMode: 0, enterprise_project_id: values.enterpriseProjectId ?? "0" }, ...(values.authentication === "key" ? { key_name: values.key } : { adminPass: values.password }) } }) });
    } else if (operation === "update") response = await huaweiFetch(session, "ecs", `${base}/${encodeURIComponent(resource!.id)}`, { method: "PUT", body: JSON.stringify({ server: { name: values.name, description: values.description ?? "" } }) });
    else if (["start", "stop", "restart"].includes(operation)) response = await runEcsAction(session, resource!.id, operation as "start" | "stop" | "restart", session.projectId);
    else if (operation === "resize") {
      if (!/^(0|postpaid|postPaid|pay_per_use|pay-per-use)$/i.test(String(resource?.values?.chargingMode))) throw new ManagementInputError("Use a pay-per-use server for this resize workflow.");
      response = await huaweiFetch(session, "ecs", `${base}/${encodeURIComponent(resource!.id)}/resize`, { method: "POST", body: JSON.stringify({ resize: { flavorRef: values.flavor } }) });
    } else if (operation === "delete") response = await huaweiFetch(session, "ecs", `${base}/delete`, { method: "POST", body: JSON.stringify({ servers: [{ id: resource!.id }], delete_volume: values.deleteVolumes ?? false, delete_publicip: values.deletePublicIp ?? false }) });
    else throw new ManagementInputError("Unsupported ECS operation.");
    const asynchronous = operation !== "update";
    return { message: `Server ${operation === "create" ? "creation" : operation === "delete" ? "deletion" : operation} ${asynchronous ? "submitted" : "completed"}.`, jobId: firstString([response.job_id], "") || undefined, resourceId: firstString([asArray(response.serverIds)[0], asArray(response.server_ids)[0], resource?.id], "") || undefined, asynchronous };
  },
};
