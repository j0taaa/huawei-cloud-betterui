import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test, type TestContext } from "node:test";

process.env.HUAWEI_IMS_ENDPOINT = "https://ims.test.invalid";
process.env.HUAWEI_ECS_ENDPOINT = "https://ecs.test.invalid";

import { validateManagementValues, ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { ManagementResource, ManagementValues } from "@/lib/management-contract";
import { imsManagement } from "@/lib/huawei/management/adapters/ims";
import { session } from "./fixtures/session";

const allowedHosts = new Set(["ims.test.invalid", "ecs.test.invalid"]);
const originalFetch = globalThis.fetch;

type RecordedCall = { url: URL; init: RequestInit | undefined; body: unknown };

function mockCloud(t: TestContext, handle: (url: URL, init: RequestInit | undefined) => unknown) {
  assert.equal(typeof originalFetch, "function");
  const calls: RecordedCall[] = [];
  t.mock.method(globalThis, "fetch", async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    if (!allowedHosts.has(url.hostname)) throw new Error(`Request to unverified endpoint: ${url.hostname}`);
    const body = init?.body === undefined ? undefined : JSON.parse(String(init.body));
    calls.push({ url, init, body });
    const response = handle(url, init);
    return response instanceof Response ? response : Response.json(response);
  });
  return calls;
}

async function submit(operationId: string, values: ManagementValues, resource?: ManagementResource) {
  const operation = imsManagement.operations.find((operation) => operation.id === operationId);
  if (!operation) throw new ManagementInputError("Unsupported operation.");
  if (operation.kind !== "create" && !resource) throw new ManagementInputError("The resource was not found in the selected project.", 404);
  const sources: Record<string, ManagementChoice[]> = imsManagement.options ? await imsManagement.options(session, operationId, resource) : {};
  const validated = validateManagementValues(operation, values, sources);
  return imsManagement.execute(session, operationId, validated, resource);
}

const recipient = "9c61004714024f9586705d090530f9fa";
const privateImage = { id: "img-1", name: "Web golden", status: "active", protected: false, visibility: "private", __imagetype: "private", __os_type: "Linux", __description: "Web server image", __whole_image: false };
const pendingShare = { id: "share-1", name: "Partner image", status: "active", protected: false, visibility: "shared", __imagetype: "shared", __os_type: "Linux", __whole_image: false, member_status: "pending" };
const memberList = { members: [
  { member_id: recipient, status: "accepted", member_type: "project", image_id: "img-1", created_at: "2026-03-01T04:07:52Z", updated_at: "2026-03-01T04:07:52Z" },
  { member_id: "domain-account", status: "accepted", member_type: "domain", image_id: "img-1", created_at: "2026-03-01T04:07:52Z" },
] };
const servers = { servers: [
  { id: "server-1", name: "Web server", status: "ACTIVE", metadata: { os_type: "Linux" }, flavor: { id: "flavor-1" } },
  { id: "server-2", name: "Building server", status: "BUILD", metadata: { os_type: "Linux" } },
] };
const imageResource: ManagementResource = { id: "image:img-1", name: "Web golden", status: "active", values: { name: "Web golden", description: "Web server image", protected: false, projectId: session.projectId } };
const sharedResource: ManagementResource = { id: "shared:share-1", name: "Partner image", status: "active" };

function read(url: URL) {
  if (url.hostname === "ecs.test.invalid") return servers;
  if (url.pathname === "/v2/cloudimages") {
    if (url.searchParams.get("__imagetype") === "private") return { images: [privateImage] };
    if (url.searchParams.get("__imagetype") === "shared") return url.searchParams.get("member_status") === "pending" ? { images: [pendingShare] } : { images: [] };
    return { images: [] };
  }
  if (url.pathname === `/v1/${session.projectId}/cloudimages/img-1/members`) return memberList;
  throw new Error(`Unexpected IMS read ${url.pathname}`);
}

test("IMS inventory separates owned private images from pending received shares", async (t) => {
  const calls = mockCloud(t, (url) => read(url));
  const resources = await imsManagement.inventory(session);
  assert.deepEqual(resources.map((resource) => resource.id), ["image:img-1", "shared:share-1"]);
  assert.deepEqual(resources[0].values, { name: "Web golden", description: "Web server image", protected: false, wholeImage: false, osType: "Linux", projectId: session.projectId });
  assert.deepEqual(resources[1].values, { osType: "Linux", wholeImage: false, memberStatus: "pending", projectId: session.projectId });
  const privateQuery = calls.find((call) => call.url.searchParams.get("__imagetype") === "private");
  assert.ok(privateQuery);
  assert.equal(privateQuery.url.hostname, "ims.test.invalid");
  const pendingQuery = calls.find((call) => call.url.searchParams.get("member_status") === "pending");
  assert.ok(pendingQuery);
  assert.equal(pendingQuery.url.searchParams.get("visibility"), "shared");
  assert.ok(calls.every((call) => call.url.hostname === "ims.test.invalid"));
  assert.deepEqual(imsManagement.invalidationKeys(imageResource), ["listImages", "cloud-summary", "ims-image:img-1:project-1"]);
  assert.deepEqual(imsManagement.invalidationKeys(), ["listImages", "cloud-summary"]);
});

test("Image creation selects live project servers and submits the documented async job", async (t) => {
  const calls = mockCloud(t, (url, init) => (init?.method ? Response.json({ job_id: "job-1" }) : read(url)));
  const choices = await imsManagement.options!(session, "create");
  assert.deepEqual(choices.instances.map((choice) => choice.value), ["server-1"]);
  await assert.rejects(submit("create", { name: "Copy", instance: "server-foreign" }), /not available/);
  const result = await submit("create", { name: "Golden copy", description: "From web server", instance: "server-1" });
  assert.equal(result.jobId, "job-1");
  assert.equal(result.asynchronous, true);
  await assert.rejects(imsManagement.execute(session, "create", { name: "Busy", instance: "server-2" } as ManagementValues), /not in a state/);
  const writes = calls.filter((call) => call.init?.method);
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url.pathname, "/v2/cloudimages/action");
  assert.deepEqual(writes[0].body, { name: "Golden copy", description: "From web server", instance_id: "server-1" });
});

test("Image names and descriptions follow the documented constraints", async (t) => {
  const calls = mockCloud(t, (url, init) => (init?.method ? Response.json({ job_id: "job-1" }) : read(url)));
  await assert.rejects(submit("create", { name: "bad<name>", instance: "server-1" }), /invalid format/);
  await assert.rejects(submit("create", { name: "Ok", description: "has <brackets>", instance: "server-1" }), /invalid format/);
  await assert.rejects(submit("create", { name: "Ok", description: "x".repeat(1025), instance: "server-1" }), /invalid format/);
  const result = await submit("create", { name: " padded name ", instance: "server-1" });
  assert.equal(result.jobId, "job-1");
  assert.deepEqual(calls[calls.length - 1].body, { name: "padded name", instance_id: "server-1" });
});

test("Image edits send the documented JSON patch array with native attribute paths", async (t) => {
  const calls = mockCloud(t, (url, init) => (init?.method === "PATCH" ? Response.json({ id: "img-1", status: "active" }) : read(url)));
  const result = await submit("update", { name: "Renamed", description: "New description" }, imageResource);
  assert.equal(result.asynchronous, undefined);
  assert.equal(result.resourceId, "image:img-1");
  const writes = calls.filter((call) => call.init?.method === "PATCH");
  assert.equal(writes.length, 1);
  assert.equal(writes[0].url.pathname, "/v2/cloudimages/img-1");
  assert.deepEqual(writes[0].body, [{ op: "replace", path: "/name", value: "Renamed" }, { op: "replace", path: "/__description", value: "New description" }]);
});

test("Image edits require an owned active private image", async (t) => {
  let image: unknown = privateImage;
  let writes = 0;
  mockCloud(t, (url, init) => {
    if (init?.method) { writes++; return Response.json({}); }
    if (url.pathname === "/v2/cloudimages" && url.searchParams.get("__imagetype") === "private") return { images: [image] };
    return read(url);
  });
  await assert.rejects(submit("update", { name: "Foreign" }, { id: "image:foreign", name: "Foreign" }), /not found in this project's private images/);
  image = { ...privateImage, status: "saving" };
  await assert.rejects(submit("update", { name: "Saving" }, { ...imageResource, status: "saving" }), /Only active images/);
  assert.equal(writes, 0);
});

test("Image deletion removes only unprotected owned private images", async (t) => {
  const calls = mockCloud(t, (url, init) => (init?.method === "DELETE" ? new Response(null, { status: 204 }) : read(url)));
  const result = await submit("delete", {}, imageResource);
  assert.equal(result.asynchronous, undefined);
  assert.equal(result.resourceId, "image:img-1");
  const writes = calls.filter((call) => call.init?.method);
  assert.deepEqual(writes.map((call) => [call.init?.method, call.url.pathname]), [["DELETE", "/v2/images/img-1"]]);
});

test("Protected or foreign images are never deleted", async (t) => {
  let image: unknown = privateImage;
  let writes = 0;
  mockCloud(t, (url, init) => {
    if (init?.method) { writes++; return Response.json({}); }
    if (url.pathname === "/v2/cloudimages" && url.searchParams.get("__imagetype") === "private") return { images: [image] };
    return read(url);
  });
  image = { ...privateImage, protected: true };
  await assert.rejects(submit("delete", {}, { ...imageResource, values: { ...imageResource.values!, protected: true } }), /protected/);
  image = privateImage;
  await assert.rejects(submit("delete", {}, { id: "image:foreign", name: "Foreign" }), /not found/);
  assert.equal(writes, 0);
});

test("Share recipients are read from the native project-scoped members endpoint", async (t) => {
  const calls = mockCloud(t, (url) => read(url));
  const result = await submit("members", {}, imageResource);
  assert.equal(result.message, "2 share recipients loaded.");
  assert.deepEqual(result.facts, [
    { label: `${recipient} · project`, value: "accepted · 2026-03-01T04:07:52Z" },
    { label: "domain-account · domain", value: "accepted · 2026-03-01T04:07:52Z" },
  ]);
  assert.ok(calls.some((call) => call.url.pathname === `/v1/${session.projectId}/cloudimages/img-1/members`));
});

test("Sharing adds and removes recipients through native asynchronous member jobs", async (t) => {
  const calls = mockCloud(t, (url, init) => (init?.method ? Response.json({ job_id: "member-job" }) : read(url)));
  await assert.rejects(submit("share-add", { projects: ["not-a-project-id"] }, imageResource), /32 hexadecimal/);
  const added = await submit("share-add", { projects: [recipient] }, imageResource);
  assert.equal(added.jobId, "member-job");
  assert.equal(added.asynchronous, true);
  const choices = await imsManagement.options!(session, "share-delete", imageResource);
  assert.deepEqual(choices.members.map((choice) => choice.value), [recipient]);
  const removed = await submit("share-delete", { projects: [recipient] }, imageResource);
  assert.equal(removed.jobId, "member-job");
  const writes = calls.filter((call) => call.init?.method);
  assert.deepEqual(writes.map((call) => [call.init?.method, call.url.pathname]), [["POST", "/v1/cloudimages/members"], ["DELETE", "/v1/cloudimages/members"]]);
  assert.deepEqual(writes[0].body, { images: ["img-1"], projects: [recipient] });
  assert.deepEqual(writes[1].body, { images: ["img-1"], projects: [recipient] });
});

test("Share removal accepts only current project memberships", async (t) => {
  let writes = 0;
  mockCloud(t, (url, init) => { if (init?.method) { writes++; return Response.json({ job_id: "job" }); } return read(url); });
  await assert.rejects(imsManagement.execute(session, "share-delete", { projects: ["c".repeat(32)] } as ManagementValues, imageResource), /currently shared/);
  await assert.rejects(imsManagement.execute(session, "share-delete", { projects: ["domain-account"] } as ManagementValues, imageResource), /currently shared/);
  assert.equal(writes, 0);
});

test("Pending received images can be accepted or rejected only for the session project", async (t) => {
  const calls = mockCloud(t, (url, init) => (init?.method ? Response.json({ job_id: "share-job" }) : read(url)));
  const accepted = await submit("accept", {}, sharedResource);
  assert.equal(accepted.jobId, "share-job");
  assert.equal(accepted.asynchronous, true);
  await submit("reject", {}, sharedResource);
  const writes = calls.filter((call) => call.init?.method);
  assert.deepEqual(writes.map((call) => call.init?.method), ["PUT", "PUT"]);
  assert.equal(writes[0].url.pathname, "/v1/cloudimages/members");
  assert.deepEqual(writes[0].body, { images: ["share-1"], project_id: session.projectId, status: "accepted" });
  assert.deepEqual(writes[1].body, { images: ["share-1"], project_id: session.projectId, status: "rejected" });
});

test("Accepting full-ECS shares or vanished shares is refused", async (t) => {
  let share: unknown = pendingShare;
  let writes = 0;
  mockCloud(t, (url, init) => {
    if (init?.method) { writes++; return Response.json({}); }
    if (url.pathname === "/v2/cloudimages" && url.searchParams.get("member_status") === "pending") return { images: [share] };
    return read(url);
  });
  share = { ...pendingShare, __whole_image: true };
  await assert.rejects(submit("accept", {}, sharedResource), /full-ECS/);
  share = pendingShare;
  await assert.rejects(submit("reject", {}, { id: "shared:vanished", name: "Vanished" }), /no longer shared/);
  assert.equal(writes, 0);
});

test("IMS job polling maps native job states and surfaces created images", async (t) => {
  let response: unknown = { status: "SUCCESS", entities: { image_id: "new-image", process_percent: 1 } };
  const calls = mockCloud(t, () => Response.json(response));
  const entry = { id: randomUUID(), service: "ims", operation: "Create image from server", jobId: "job-1", projectId: session.projectId, state: "submitted" as const, startedAt: new Date().toISOString() };
  let outcome = await imsManagement.poll!(session, entry);
  assert.deepEqual(outcome, { state: "succeeded", message: "The image job completed successfully.", resourceId: "image:new-image" });
  assert.equal(calls[0].url.pathname, "/v1/cloudimages/job/job-1");
  response = { status: "FAIL", fail_reason: "Insufficient image quota", entities: {} };
  outcome = await imsManagement.poll!(session, entry);
  assert.equal(outcome.state, "failed");
  assert.match(outcome.message ?? "", /Insufficient image quota/);
  response = { status: "RUNNING", entities: { process_percent: 0.4 } };
  outcome = await imsManagement.poll!(session, entry);
  assert.equal(outcome.state, "submitted");
  assert.equal(outcome.resourceId, undefined);
});
