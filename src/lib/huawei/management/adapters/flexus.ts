import "server-only";

import { ManagementInputError, type ManagementField, type ManagementOperation, type ManagementOutcome } from "@/lib/management-contract";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import {
  assertNativeFlexusPassword,
  assertNativeFlexusServerReady,
  findNativeFlexusLBundle,
  flexusUpdateFingerprint,
  getNativeFlexusLServer,
  getNativeFlexusXServer,
  listNativeFlexusLInstances,
  listNativeFlexusXInstances,
  parseFlexusResourceId,
  pollNativeFlexusJob,
  resetNativeFlexusServerPassword,
  runNativeFlexusServerAction,
  updateNativeFlexusServer,
  type FlexusResourceTarget,
  type NativeFlexusServer,
} from "@/lib/huawei/services/flexus-native";
import type { ManagementAdapter } from "../types";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementResource } from "@/lib/management-contract";
import { finishCloudLoad } from "@/lib/huawei/errors";
import { flexusRdsManagement } from "./flexus-rds";

/*
 * Explicit console gaps left for root coverage; none of these has a verified live contract in the
 * reviewed notes, so this draft never guesses them:
 * - Flexus L creation (POST /v1/light-instances) requires a live plan_spec/image_ref catalog that is
 *   not yet verified; only a typed unpaid order on a current verified offering would be safe.
 * - Flexus L deletion and renewal must go through prepaid bundle unsubscription and renewal orders;
 *   an ECS delete is never used to bypass prepaid unsubscription.
 * - Flexus X creation and performance resize require the current live X flavor catalog with exact
 *   x1.Nu.Ng / x1e.Nu.Ng flavorRef values and prepaid quota proof.
 * - Tag lifecycle operations have no verified Flexus contract in the reviewed notes.
 * - Hostname changes (which require a restart) are not exposed by the metadata update.
 *
 * Plane auth: the L catalog is proven on the account plane (unscoped account token plus the exact
 * domain), while every mutation is enforced on the exactly selected project. Each L mutation
 * refreshes the original RMS bundle-to-server linkage and the current product bundle name; the
 * selected resource name must be that fresh bundle name, which is distinct from the native cloud
 * server name confirmed separately for renames. X mutations require the fresh native server name.
 */

const currentNameField = {
  key: "currentName",
  label: "Current server name",
  required: true,
  max: 64,
  help: "Type the server's current native name exactly; it is rechecked against Huawei before the change.",
} satisfies ManagementField;
const serverNameField = {
  key: "name",
  label: "New server name",
  min: 1,
  max: 64,
  pattern: "^[\\u4e00-\\u9fa5A-Za-z0-9_.-]{1,64}$",
  help: "1-64 characters of letters, digits, Chinese characters, underscore, hyphen, or dot. This renames the cloud server, not the product bundle.",
} satisfies ManagementField;
const descriptionField = {
  key: "description",
  label: "Description",
  type: "textarea",
  max: 85,
  maxBytes: 255,
  allowEmpty: true,
  help: "Up to 85 characters; the characters < and > are not allowed. Leave it empty to clear the description.",
} satisfies ManagementField;
const passwordField = {
  key: "password",
  label: "New administrator password",
  type: "password",
  required: true,
  min: 8,
  max: 26,
  help: "8-26 characters combining at least three of lowercase, uppercase, digits, and the special characters !@%-_=+[]:./? It cannot contain root, Administrator, their reverses, or three consecutive characters of Administrator.",
} satisfies ManagementField;

const flexusPrefixes = ["l:", "x:"];

const operations: ManagementOperation[] = [
  {
    id: "inspect",
    label: "Inspect server",
    kind: "inspect",
    description: "Load the server's verified native identity, state, and Flexus linkage. Raw metadata, unknown statuses, and secrets are never shown.",
    fields: [],
    resourcePrefixes: flexusPrefixes,
  },
  {
    id: "start",
    label: "Start server",
    kind: "action",
    description: "Power on a shut-off Flexus server through its native start action.",
    fields: [],
    confirmation: true,
    resourcePrefixes: flexusPrefixes,
    impact: "The server boots and serves traffic again. A prepaid Flexus L bundle keeps its subscription billing; a running Flexus X server bills compute by its plan.",
  },
  {
    id: "stop",
    label: "Stop server",
    kind: "action",
    description: "Gracefully shut down the operating system.",
    fields: [],
    confirmation: true,
    resourcePrefixes: flexusPrefixes,
    impact: "Applications stop and the server becomes unreachable until it is started again. Attached disks, public IPs, and prepaid subscriptions keep their charges.",
  },
  {
    id: "soft-reboot",
    label: "Soft reboot",
    kind: "action",
    description: "Gracefully restart the operating system.",
    fields: [],
    confirmation: true,
    resourcePrefixes: flexusPrefixes,
    impact: "Connections are closed and the server is unavailable until the restart completes; unsaved work can be lost.",
  },
  {
    id: "update-server",
    label: "Rename or describe server",
    kind: "update",
    description:
      "Change the cloud server's name and description after confirming its fresh native name. The change is verified against a fresh readback and stays pending with its fingerprint until the readback matches. The product bundle name of a Flexus L instance is not changed.",
    fields: [currentNameField, serverNameField, descriptionField],
    resourcePrefixes: flexusPrefixes,
  },
  {
    id: "reset-password",
    label: "Reset administrator password",
    kind: "action",
    description:
      "Replace the OS administrator password through the native one-click reset. The native acknowledgement carries no job, so the reset stays pending manual verification unless Huawei provides a native job.",
    fields: [passwordField],
    confirmation: true,
    resourcePrefixes: flexusPrefixes,
    impact: "The OS administrator password is replaced. Sessions and integrations using the old password stop working; sign in with the new password to verify it.",
  },
];

function inspectOutcome(target: FlexusResourceTarget, server: NativeFlexusServer): ManagementOutcome {
  const facts = [
    { label: "Server ID", value: server.id },
    { label: "Native name", value: server.name },
    { label: "Status", value: server.statusKnown ? server.status : "Unknown" },
    { label: "Current task", value: server.taskStateVerified ? (server.taskState === null ? "none" : "active") : "unverified" },
    { label: "Project", value: server.tenantId },
    ...(server.zone ? [{ label: "Zone", value: server.zone }] : []),
    ...(target.kind === "l"
      ? [
          { label: "Flexus L bundle", value: target.bundleId ?? "" },
          { label: "Bundle lock", value: `${server.lockSource} · ${server.lockSourceId === target.bundleId ? "verified" : "unverified"}` },
          { label: "Charge mode", value: server.chargingMode === "1" ? "prePaid" : "unverified" },
        ]
      : [
          {
            label: "Flavor",
            value:
              server.flavorVcpus !== null && server.flavorRamMb !== null
                ? `${server.flavorName} · ${server.flavorVcpus} vCPU · ${server.flavorRamMb / 1024} GB RAM`
                : server.flavorName,
          },
        ]),
  ];
  return { message: `Native details loaded for ${server.name}.`, facts };
}

async function flexusPlaneInventory(session: BetterUiSession, kind: "l" | "x"): Promise<ManagementResource[]> {
  if (kind === "l") return (await listNativeFlexusLInstances(session)).map((instance) => ({
        id: `l:${instance.bundleId}:${instance.serverId}`,
        name: instance.name,
        values: {
          kind: "L",
          bundleId: instance.bundleId,
          serverId: instance.serverId,
          chargeMode: instance.chargingMode === "prePaid" ? "prePaid" : "unverified",
        },
      }));
  return (await listNativeFlexusXInstances(session)).map((instance) => ({
        id: `x:${instance.serverId}`,
        name: instance.name,
        status: instance.status,
        values: { kind: "X", serverId: instance.serverId, flavor: instance.flavor, vcpus: instance.vcpus, ramGb: instance.ramGb },
      }));
}

export const flexusManagement: ManagementAdapter = {
  title: "Flexus",
  operations: [...operations, ...flexusRdsManagement.operations],
  inventory: async (session) => {
    const results = await Promise.allSettled([flexusPlaneInventory(session, "l"), flexusPlaneInventory(session, "x"), flexusRdsManagement.inventory(session)]);
    return finishCloudLoad(results, results.flatMap(result => result.status === "fulfilled" ? result.value : []), ["Flexus L", "Flexus X", "Flexus RDS"]);
  },
  inventoryForResource: (session, id) => id.startsWith("rds:") ? flexusRdsManagement.inventory(session) : flexusPlaneInventory(session, parseFlexusResourceId(id).kind),
  options: (session, operation, resource) => flexusRdsManagement.operations.some(item => item.id === operation) ? flexusRdsManagement.options!(session, operation, resource) : Promise.resolve({}),
  poll: async (session, entry) => entry.resourceId?.startsWith("rds:") ? flexusRdsManagement.poll!(session, entry) : pollNativeFlexusJob(session, entry),
  invalidationKeys: (resource) => {
    if (resource?.id.startsWith("rds:")) return [cloudCacheKeys.listFlexusResources, ...flexusRdsManagement.invalidationKeys(resource)];
    const serverId = resource ? parseFlexusResourceId(resource.id).serverId : undefined;
    return [cloudCacheKeys.listFlexusResources, cloudCacheKeys.listEcsInstances, cloudCacheKeys.summary,
      ...(serverId ? [cloudCacheKeys.ecs(serverId), cloudCacheKeys.ecsMonitoring(serverId), cloudCacheKeys.ecsSnapshots(serverId)] : [])];
  },
  execute: async (session, operation, values, resource): Promise<ManagementOutcome> => {
    if (flexusRdsManagement.operations.some(item => item.id === operation)) return flexusRdsManagement.execute(session, operation, values, resource);
    const target = parseFlexusResourceId(resource?.id);
    const mutation = operation !== "inspect";
    const selectedName = typeof resource?.name === "string" ? resource.name : "";
    if (mutation && !selectedName) throw new ManagementInputError("Select the Flexus resource again to load its fresh native name.", 409);
    let server: NativeFlexusServer;
    if (target.kind === "l") {
      if (mutation) {
        const bundle = await findNativeFlexusLBundle(session, target.bundleId!);
        if (bundle.serverId !== target.serverId) {
          throw new ManagementInputError("The Flexus L bundle no longer links to this server. Refresh the inventory and try again.", 409);
        }
        if (selectedName !== bundle.name) {
          throw new ManagementInputError("The selected Flexus L bundle name is not fresh. Refresh the inventory and try again.", 409);
        }
      }
      server = await getNativeFlexusLServer(session, target.bundleId!, target.serverId);
    } else {
      server = await getNativeFlexusXServer(session, target.serverId);
      if (mutation && selectedName !== server.name) {
        throw new ManagementInputError("The selected Flexus X server name is not fresh. Refresh the inventory and try again.", 409);
      }
    }
    if (operation === "inspect") return inspectOutcome(target, server);
    assertNativeFlexusServerReady(server, operation);
    if (operation === "start" || operation === "stop" || operation === "soft-reboot") {
      const action = operation === "start" ? "os-start" : operation === "stop" ? "os-stop" : "reboot";
      const jobId = await runNativeFlexusServerAction(session, target.kind, target.serverId, action);
      const message =
        operation === "start" ? "Server start submitted." : operation === "stop" ? "Server soft shutdown submitted." : "Server soft reboot submitted.";
      return { message, resourceId: resource!.id, jobId, asynchronous: true };
    }
    if (operation === "update-server") {
      if (String(values.currentName) !== server.name) {
        throw new ManagementInputError("The confirmed current name does not match the server's fresh native name. Refresh the form and try again.", 409);
      }
      const patch: { name?: string; description?: string } = {};
      if (values.name !== undefined) patch.name = String(values.name);
      if (values.description !== undefined) patch.description = String(values.description);
      if (!Object.keys(patch).length) throw new ManagementInputError("Enter a new server name or a description.");
      if (patch.description !== undefined && /[<>]/.test(patch.description)) {
        throw new ManagementInputError("The description cannot contain the characters < or >.");
      }
      await updateNativeFlexusServer(session, target.kind, target.serverId, patch);
      const verification = flexusUpdateFingerprint(patch);
      const readback =
        target.kind === "l"
          ? await getNativeFlexusLServer(session, target.bundleId!, target.serverId)
          : await getNativeFlexusXServer(session, target.serverId);
      const nameMatches = patch.name === undefined || readback.name === patch.name;
      const descriptionMatches = patch.description === undefined || (typeof readback.description === "string" && readback.description === patch.description);
      if (nameMatches && descriptionMatches) {
        return { message: "Server name and description update accepted and verified on the fresh server state.", resourceId: resource!.id, verification };
      }
      return {
        message: "Server name and description update accepted; the change is not visible on the fresh server state yet and stays pending.",
        resourceId: resource!.id,
        observationId: target.serverId,
        asynchronous: true,
        verification,
      };
    }
    if (operation === "reset-password") {
      const password = String(values.password);
      assertNativeFlexusPassword(password);
      const jobId = await resetNativeFlexusServerPassword(session, target.kind, target.serverId, password);
      return {
        message: jobId
          ? "Administrator password reset accepted. The reset is running as a native cloud job; sign in with the new password once it completes."
          : "Administrator password reset accepted with no native job. It is pending manual verification; sign in with the new password to confirm it.",
        resourceId: resource!.id,
        asynchronous: true,
        ...(jobId ? { jobId } : {}),
      };
    }
    throw new ManagementInputError("Unsupported Flexus operation.");
  },
};
