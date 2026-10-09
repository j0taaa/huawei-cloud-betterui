import "server-only";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listEvsDisksForProject, listEvsSnapshotsForProject, createEvsDisk, updateEvsDisk, extendEvsDisk, deleteEvsDisk, attachEvsDiskToEcs, detachEvsDiskFromEcs, createEvsSnapshot, deleteEvsSnapshot, rollbackEvsSnapshot } from "@/lib/huawei/services/evs";
import { listEcsInstancesForProject } from "@/lib/huawei/services/ecs";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice, type ManagementField } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
const name: ManagementField = { key: "name", label: "Name", required: true, max: 255 };
const description: ManagementField = { key: "description", label: "Description", type: "textarea", max: 255, allowEmpty: true };
const size: ManagementField = { key: "size", label: "Capacity (GB)", type: "number", required: true, min: 10, max: 32768, defaultValue: 100 };
const snapshot: ManagementField = { key: "snapshot", label: "Current disk snapshot", type: "select", source: "snapshots", required: true };
export const evsManagement: ManagementAdapter = {
  title: "Elastic Volume Service",
  operations: [
    { id: "create", label: "Create disk", kind: "create", description: "Create one unencrypted pay-per-use data disk with live region type and availability-zone choices.", fields: [name, description, size, { key: "zone", label: "Availability zone", type: "select", source: "zones", required: true }, { key: "type", label: "Storage type", type: "select", source: "types", required: true }, { key: "shared", label: "Shared disk", type: "boolean", defaultValue: false }], impact: "Allocated storage incurs charges until deleted. Shared disks require a cluster-aware filesystem to avoid data corruption." },
    { id: "update", label: "Edit disk", kind: "update", description: "Rename the disk and edit its description.", fields: [name, description] },
    { id: "expand", label: "Expand disk", kind: "action", description: "Increase disk capacity. Extend the partition and filesystem in the operating system afterwards.", fields: [size], allowedStatuses: ["available", "in-use"], impact: "Additional storage increases charges. Expansion cannot be undone." },
    { id: "delete", label: "Delete detached disk", kind: "delete", description: "Permanently delete a disk with no server attachment.", fields: [], allowedStatuses: ["available", "error"], confirmation: true, impact: "All data on this disk is permanently deleted. Snapshots and backups are separate resources." },
    { id: "attach", label: "Attach disk", kind: "action", description: "Attach a detached data disk to an eligible ECS in the same availability zone.", fields: [{ key: "server", label: "ECS", type: "select", source: "servers", required: true }, { key: "device", label: "Device name", required: true, defaultValue: "/dev/sdb", pattern: "^/dev/(?:sd|vd|xvd)[b-z]$", max: 16 }], allowedStatuses: ["available"], impact: "The disk becomes available to the selected server. Mount existing filesystems without formatting them." },
    { id: "detach", label: "Detach data disk", kind: "action", description: "Detach a nonbootable data disk without forcing removal. Unmount it in the operating system first.", fields: [], allowedStatuses: ["in-use"], confirmation: true, impact: "Unmount the filesystem and stop disk access before detaching to avoid data loss." },
    { id: "snapshots", label: "View snapshots", kind: "inspect", description: "List every current snapshot belonging to this disk.", fields: [] },
    { id: "create-snapshot", label: "Create disk snapshot", kind: "action", description: "Capture the disk. Quiesce applications for consistency when it is attached.", fields: [name, description], allowedStatuses: ["available", "in-use"], impact: "Snapshot storage incurs charges. Attached-disk snapshots may be crash-consistent rather than application-consistent." },
    { id: "delete-snapshot", label: "Delete disk snapshot", kind: "action", description: "Delete a current available snapshot owned by this disk.", fields: [snapshot], confirmation: true, impact: "This recovery point is permanently removed." },
    { id: "rollback", label: "Roll back disk from snapshot", kind: "action", description: "Restore a current snapshot to its detached source disk.", fields: [snapshot], allowedStatuses: ["available"], confirmation: true, impact: "Current disk contents are overwritten by the snapshot. Changes since the snapshot are lost." },
  ],
  inventory: async s => (await listEvsDisksForProject(s)).map(d => ({ id: d.id, name: d.name, status: d.status.toLowerCase(), values: { name: d.name, description: d.description, size: d.rawSizeGb } })),
  options: async (s, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create") {
      const [zones, types] = await Promise.all([huaweiFetch<Record<string, unknown>>(s, "evs", `/v2/${s.projectId}/os-availability-zone`), huaweiFetch<Record<string, unknown>>(s, "evs", `/v2/${s.projectId}/types`)]);
      return { zones: asArray(zones.availabilityZoneInfo).map(asRecord).filter(z => asRecord(z.zoneState).available === true).map(z => ({ value: String(z.zoneName), label: String(z.zoneName) })), types: asArray(types.volume_types).map(asRecord).filter(t => t.is_public !== false).map(t => ({ value: String(t.name), label: String(t.name) })) };
    }
    if (!resource) return {};
    if (operation === "attach") {
      const disk = (await listEvsDisksForProject(s)).find(d => d.id === resource.id);
      if (!disk) throw new ManagementInputError("The disk no longer exists.", 404);
      return { servers: (await listEcsInstancesForProject(s)).filter(server => ["ACTIVE", "SHUTOFF"].includes(server.status) && server.availabilityZone === disk.availabilityZone).map(server => ({ value: server.id, label: `${server.name} · ${server.status} · ${server.availabilityZone}` })) };
    }
    if (["delete-snapshot", "rollback"].includes(operation)) return { snapshots: (await listEvsSnapshotsForProject(s, resource.id)).filter(snapshot => snapshot.diskId === resource.id && snapshot.status.toLowerCase() === "available").map(snapshot => ({ value: snapshot.id, label: `${snapshot.name} · ${snapshot.createdAt}` })) };
    return {};
  },
  invalidationKeys: r => [cloudCacheKeys.listEvsDisks, "evs-page-inventory", "evs-snapshot-inventory", cloudCacheKeys.listEcsInstances, cloudCacheKeys.summary, ...(r ? [cloudCacheKeys.evs(r.id)] : [])],
  poll: async (s, entry) => {
    const service = ["Attach disk", "Detach data disk"].includes(entry.operation) ? "ecs" : "evs";
    const job = await huaweiFetch<Record<string, unknown>>(s, service, `/v1/${s.projectId}/jobs/${encodeURIComponent(entry.jobId!)}`);
    const state = job.status === "SUCCESS" ? "succeeded" : job.status === "FAIL" ? "failed" : "submitted";
    const entities = asRecord(job.entities);
    return { state, message: state === "failed" ? firstString([job.fail_reason, job.error_msg], "Disk operation failed.") : state === "succeeded" ? "Disk operation completed." : "Disk operation is still processing.", resourceId: firstString([entities.volume_id], "") || undefined };
  },
  execute: async (s, operation, v, resource) => {
    if (operation === "create") {
      const types = await huaweiFetch<Record<string, unknown>>(s, "evs", `/v2/${s.projectId}/types`);
      const type = asArray(types.volume_types).map(asRecord).find(t => t.name === v.type);
      const typeZones = String(asRecord(type?.extra_specs)["RESKEY:availability_zones"] ?? "").split(",").filter(Boolean);
      if (typeZones.length && !typeZones.includes(String(v.zone))) throw new ManagementInputError("This storage type is not available in the selected availability zone.");
      const result = await createEvsDisk(s, { name: String(v.name), description: String(v.description ?? ""), sizeGb: Number(v.size), availabilityZone: String(v.zone), volumeType: String(v.type), isShareable: v.shared === true, projectId: s.projectId });
      return { message: "Disk creation submitted.", jobId: result.job_id, resourceId: result.volume?.id ?? result.volume_ids?.[0], asynchronous: true };
    }
    const disk = (await listEvsDisksForProject(s)).find(d => d.id === resource!.id);
    if (!disk) throw new ManagementInputError("The disk no longer exists in this project.", 404);
    // Read all attachments; the inventory's display field contains only the first attachment.
    const attachmentIds = async () => {
      const response = await huaweiFetch<Record<string, unknown>>(s, "evs", `/v2/${s.projectId}/cloudvolumes/${encodeURIComponent(disk.id)}`);
      const volume = asRecord(response.volume);
      if (volume.id !== disk.id || !Array.isArray(volume.attachments)) throw new ManagementInputError("Unable to verify the disk attachments. Refresh its details before retrying.", 409);
      return asArray(volume.attachments).map(asRecord).map(a => String(a.server_id ?? "")).filter(Boolean);
    };
    if (operation === "snapshots") { const items = (await listEvsSnapshotsForProject(s, disk.id)).filter(item => item.diskId === disk.id); return { message: `${items.length} disk snapshots loaded.`, facts: items.map(item => ({ label: `${item.name} · ${item.id}`, value: `${item.status} · ${item.createdAt} · ${item.size}` })) }; }
    if (operation === "update") { await updateEvsDisk(s, disk.id, { name: String(v.name), description: String(v.description ?? "") }, s.projectId); return { message: "Disk updated." }; }
    let result: Record<string, unknown> = {};
    if (operation === "expand") {
      if (Number(v.size) <= disk.rawSizeGb) throw new ManagementInputError("New capacity must exceed the disk's current capacity.");
      result = await extendEvsDisk(s, disk.id, Number(v.size), s.projectId);
    } else if (operation === "delete") {
      if (disk.attachedServerId || (await attachmentIds()).length) throw new ManagementInputError("Detach every server before deleting this disk.", 409);
      result = await deleteEvsDisk(s, disk.id, s.projectId);
    } else if (operation === "attach") {
      if (disk.attachedServerId || (await attachmentIds()).length) throw new ManagementInputError("Use a detached disk for this attachment workflow.", 409);
      const server = (await listEcsInstancesForProject(s)).find(server => server.id === v.server);
      if (!server || server.availabilityZone !== disk.availabilityZone || !["ACTIVE", "SHUTOFF"].includes(server.status)) throw new ManagementInputError("Select an eligible server in the disk's availability zone.");
      result = await attachEvsDiskToEcs(s, disk.id, server.id, String(v.device), disk.type, s.projectId);
    } else if (operation === "detach") {
      if (disk.isBootable === "true") throw new ManagementInputError("System and bootable disks require their server-specific disk workflow.", 409);
      const ids = await attachmentIds();
      if (ids.length !== 1) throw new ManagementInputError("Select a disk attached to exactly one server. Shared-disk detach requires choosing an explicit attachment.", 409);
      if (!(await listEcsInstancesForProject(s)).some(server => server.id === ids[0])) throw new ManagementInputError("The attached server no longer exists in this project.", 404);
      result = await detachEvsDiskFromEcs(s, disk.id, ids[0], false, s.projectId);
    } else if (operation === "create-snapshot") result = await createEvsSnapshot(s, disk.id, String(v.name), String(v.description ?? ""), s.projectId);
    else if (operation === "delete-snapshot" || operation === "rollback") {
      const selected = (await listEvsSnapshotsForProject(s, disk.id)).find(snapshot => snapshot.id === v.snapshot && snapshot.diskId === disk.id && snapshot.status.toLowerCase() === "available");
      if (!selected) throw new ManagementInputError("The available snapshot no longer belongs to this disk.", 404);
      if (operation === "rollback") {
        if (disk.attachedServerId || (await attachmentIds()).length) throw new ManagementInputError("Detach the disk before rollback.", 409);
        result = await rollbackEvsSnapshot(s, selected.id, disk.id, s.projectId);
      } else result = await deleteEvsSnapshot(s, selected.id, s.projectId);
    } else throw new ManagementInputError("Unsupported disk operation.");
    return { message: "Disk operation submitted. Check cloud job or resource state for completion.", jobId: firstString([result.job_id], "") || undefined, resourceId: operation === "create-snapshot" ? firstString([asRecord(result.snapshot).id, result.id], "") || undefined : disk.id, asynchronous: true };
  },
};
