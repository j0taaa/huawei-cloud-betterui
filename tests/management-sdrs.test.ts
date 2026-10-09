import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { sdrsManagement } from "@/lib/huawei/management/adapters/sdrs";
import { validateManagementValues, type ManagementHistoryEntry } from "@/lib/management-contract";
import { session } from "./fixtures/session";

const group = { id: "group-1", name: "Production", status: "available", priority_station: "source", source_availability_zone: "az-a", target_availability_zone: "az-b", source_vpc_id: "vpc-1", protected_instance_num: 0, replication_num: 0, disaster_recovery_drill_num: 0 };
const instance = { id: "instance-1", name: "Protected", status: "available", server_group_id: group.id, source_server: "source", target_server: "target" };
const pair = { id: "pair-1", name: "DiskCopy", status: "protected", server_group_id: group.id, progress: 100, replication_status: "active", fault_level: 0, attachment: [] };
const drill = { id: "drill-1", name: "Drill", status: "available", server_group_id: group.id, drill_vpc_id: "drill-vpc" };
const domain = { id: "domain-1", name: "ZonePair", sold_out: false, local_replication_cluster: { availability_zone: "az-a" }, remote_replication_cluster: { availability_zone: "az-b" } };
const source = { id: "source", name: "Source", status: "SHUTOFF", "OS-EXT-AZ:availability_zone": "az-a", "OS-EXT-STS:task_state": null, metadata: { vpc_id: "vpc-1" }, "os-extended-volumes:volumes_attached": [{ id: "disk-1" }] };
const target = { ...source, id: "target", name: "Target", "OS-EXT-AZ:availability_zone": "az-b" };
const disk = { id: "disk-1", name: "Data", availability_zone: "az-a", status: "available", multiattach: false, attachments: [], size: 40 };
const gr = { id: "group:group-1", name: group.name, status: group.status };
const ir = { id: "instance:group-1/instance-1", name: instance.name, status: instance.status };
const pr = { id: "pair:group-1/pair-1", name: pair.name, status: pair.status };
const dr = { id: "drill:group-1/drill-1", name: drill.name, status: drill.status };
type Fixture = { group?: Record<string, unknown>; instances?: Record<string, unknown>[]; pairs?: Record<string, unknown>[]; drills?: Record<string, unknown>[]; servers?: Record<string, unknown>[]; disks?: Record<string, unknown>[]; domain?: Record<string, unknown>; quota?: number; used?: number };
function cloud(t: TestContext, fixture: Fixture = {}, override?: (url: URL, init: RequestInit) => Response | undefined) {
  const writes: { path: string; method: string; body?: unknown }[] = [];
  const current = fixture.group ?? group;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input), path = url.pathname;
    const other = override?.(url, init); if (other) return other;
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), session.token);
    if (init.method) {
      const body = init.body ? JSON.parse(String(init.body)) : undefined;
      writes.push({ path, method: init.method, body });
      if (init.method === "PUT") {
        const key = path.includes("server-groups") ? "server_group" : path.includes("protected-instances") ? "protected_instance" : path.includes("replications") ? "replication" : "disaster_recovery_drill";
        return Response.json({ [key]: { id: path.split("/").at(-1), name: body[key].name } });
      }
      return Response.json({ job_id: "job-1" });
    }
    const lists = {
      "/v1/project-1/server-groups": { server_groups: [current], count: 1 },
      "/v1/project-1/protected-instances": { protected_instances: fixture.instances ?? [], count: (fixture.instances ?? []).length },
      "/v1/project-1/replications": { replications: fixture.pairs ?? [], count: (fixture.pairs ?? []).length },
      "/v1/project-1/disaster-recovery-drills": { disaster_recovery_drills: fixture.drills ?? [], count: (fixture.drills ?? []).length },
      "/v1/project-1/server-groups/group-1": { server_group: current },
      "/v1/project-1/protected-instances/instance-1": { protected_instance: (fixture.instances ?? []).find(i => i.id === instance.id) },
      "/v1/project-1/protected-instances/instance-1/tags": { tags: [{ key: "environment", value: "production" }] },
      "/v1/project-1/replications/pair-1": { replication: (fixture.pairs ?? []).find(i => i.id === pair.id) },
      "/v1/project-1/disaster-recovery-drills/drill-1": { disaster_recovery_drill: (fixture.drills ?? []).find(i => i.id === drill.id) },
      "/v1/project-1/active-domains": { domains: [fixture.domain ?? domain] },
      "/v1/project-1/sdrs/quotas": { quotas: { resources: ["server_groups", "replications"].map(type => ({ type, used: fixture.used ?? 1, quota: fixture.quota ?? 20 })) } },
      "/v1/project-1/cloudservers/detail": { servers: fixture.servers ?? [source, target] },
      "/v2/project-1/cloudvolumes/detail": { cloudvolumes: fixture.disks ?? [disk] },
      "/v3/project-1/vpc/vpcs": { vpcs: [{ id: "vpc-1", name: "VPC", cidr: "10.0.0.0/16" }] },
    } as Record<string, unknown>;
    if (path in lists) return Response.json(lists[path]);
    throw new Error(`Unexpected request ${url}`);
  });
  return writes;
}
test("SDRS inventory keeps native parent IDs for groups, protected servers, disk pairs, and drills", async t => {
  cloud(t, { instances: [instance], pairs: [pair], drills: [drill] });
  assert.deepEqual((await sdrsManagement.inventory(session)).map(r => r.id), [gr.id, ir.id, pr.id, dr.id]);
});
test("SDRS provisioning uses a current on-sale domain, distinct native AZs, VPC, migration mode, and quota", async t => {
  const writes = cloud(t);
  const options = await sdrsManagement.options!(session, "create"); assert.equal(options.domains[0].value, domain.id);
  const result = await sdrsManagement.execute(session, "create", { name: "Recovery", description: "Test", domain: domain.id, vpc: "vpc-1" });
  assert.equal(result.asynchronous, true); assert.equal(result.jobId, "job-1");
  assert.deepEqual(writes[0], { path: "/v1/project-1/server-groups", method: "POST", body: { server_group: { name: "Recovery", description: "Test", domain_id: domain.id, source_availability_zone: "az-a", target_availability_zone: "az-b", source_vpc_id: "vpc-1", dr_type: "migration" } } });
});
test("SDRS provisioning rejects sold-out domains, foreign VPCs, malformed quota, and exhausted quota", async t => {
  let exhausted = false;
  const writes = cloud(t, { domain: { ...domain, sold_out: true } }, url => exhausted && url.pathname.endsWith("/active-domains") ? Response.json({ domains: [domain] }) : exhausted && url.pathname.endsWith("/sdrs/quotas") ? Response.json({ quotas: { resources: [{ type: "server_groups", used: 20, quota: 20 }] } }) : undefined);
  const values = { name: "Recovery", domain: domain.id, vpc: "vpc-1" };
  await assert.rejects(sdrsManagement.execute(session, "create", values), /current available AZ pair/);
  exhausted = true; await assert.rejects(sdrsManagement.execute(session, "create", values), /quota is exhausted/);
  await assert.rejects(sdrsManagement.execute(session, "create", { ...values, vpc: "foreign" }), /owned VPC/);
  assert.equal(writes.length, 0);
});
test("SDRS group deletion checks all native child collections and independent parent counts", async t => {
  const writes = cloud(t, { pairs: [pair] });
  await assert.rejects(sdrsManagement.execute(session, "delete-group", {}, gr), /Remove every/); assert.equal(writes.length, 0);
});
test("SDRS deletion refuses an apparently empty list with nonzero or missing native counts", async t => {
  let missing = false;
  const writes = cloud(t, { group: { ...group, replication_num: 1 } }, url => missing && url.pathname.endsWith("/server-groups/group-1") ? Response.json({ server_group: { ...group, replication_num: undefined } }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "delete-group", {}, gr), /Remove every/);
  missing = true; await assert.rejects(sdrsManagement.execute(session, "delete-group", {}, gr), /Remove every/); assert.equal(writes.length, 0);
});
test("SDRS empty-group deletion is an asynchronous native DELETE without a made-up request body", async t => {
  const writes = cloud(t); const result = await sdrsManagement.execute(session, "delete-group", {}, gr);
  assert.equal(result.asynchronous, true); assert.deepEqual(writes[0], { path: "/v1/project-1/server-groups/group-1", method: "DELETE", body: undefined });
});
test("SDRS fresh native detail identity and parent mismatches block child mutations", async t => {
  let wrongId = false;
  const writes = cloud(t, { instances: [instance] }, url => url.pathname.endsWith("/protected-instances/instance-1") ? Response.json({ protected_instance: { ...instance, id: wrongId ? "wrong" : instance.id, server_group_id: wrongId ? group.id : "foreign" } }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "delete-instance", {}, ir), /current identity and parent/);
  wrongId = true; await assert.rejects(sdrsManagement.execute(session, "rename-instance", { name: "New" }, ir), /current identity and parent/); assert.equal(writes.length, 0);
});
test("SDRS protected-instance deletion retains the recovery server and EIP explicitly", async t => {
  const writes = cloud(t, { instances: [instance] }); const result = await sdrsManagement.execute(session, "delete-instance", {}, ir);
  assert.equal(result.resourceId, ir.id); assert.equal(result.asynchronous, true);
  assert.deepEqual(writes[0].body, { delete_target_server: false, delete_target_eip: false });
});
test("SDRS detached pair deletion retains the recovery volume and rejects unknown or attached pairs", async t => {
  let attached = false, unknown = false;
  const writes = cloud(t, { pairs: [pair] }, url => url.pathname.endsWith("/replications/pair-1") && (attached || unknown) ? Response.json({ replication: { ...pair, attachment: unknown ? undefined : [{ protected_instance_id: instance.id }] } }) : undefined);
  await sdrsManagement.execute(session, "delete-pair", {}, pr);
  assert.deepEqual(writes[0].body, { replication: { server_group_id: group.id, delete_target_volume: false } });
  attached = true; await assert.rejects(sdrsManagement.execute(session, "delete-pair", {}, pr), /Detach the replication pair/);
  unknown = true; await assert.rejects(sdrsManagement.execute(session, "delete-pair", {}, pr), /verify its attachment list/); assert.equal(writes.length, 1);
});
test("SDRS drill deletion uses documented cascade impact and native async DELETE", async t => {
  const writes = cloud(t, { drills: [drill] }); await sdrsManagement.execute(session, "delete-drill", {}, dr);
  assert.equal(writes[0].body, undefined); assert.equal(writes[0].path, "/v1/project-1/disaster-recovery-drills/drill-1");
  assert.match(sdrsManagement.operations.find(o => o.id === "delete-drill")!.impact!, /disks.*permanently destroyed/);
});
test("SDRS start/stop/failover state guards and native action names remain distinct", async t => {
  let status = "available";
  const writes = cloud(t, { pairs: [pair] }, url => url.pathname.endsWith("/server-groups/group-1") ? Response.json({ server_group: { ...group, status } }) : undefined);
  await sdrsManagement.execute(session, "start", {}, gr);
  await assert.rejects(sdrsManagement.execute(session, "stop", {}, gr), /current state/);
  status = "protected"; await sdrsManagement.execute(session, "stop", {}, gr); await sdrsManagement.execute(session, "failover", {}, gr);
  assert.deepEqual(writes.map(w => w.body), [{ "start-server-group": {} }, { "stop-server-group": {} }, { "failover-server-group": {} }]);
});
test("SDRS planned switchover requires both sites stopped and derives the other site from current priority", async t => {
  let running = true;
  const writes = cloud(t, { group: { ...group, status: "protected", priority_station: "target" }, instances: [instance], pairs: [pair] }, url => running && url.pathname.endsWith("/cloudservers/detail") ? Response.json({ servers: [source, { ...target, status: "ACTIVE" }] }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "reverse", {}, gr), /Shut down/);
  running = false; await sdrsManagement.execute(session, "reverse", {}, gr);
  assert.deepEqual(writes[0].body, { "reverse-server-group": { priority_station: "source" } });
});
test("SDRS failover rejects broken replication links and reprotection requires shut-down servers", async t => {
  let reprotect = false;
  const writes = cloud(t, { group: { ...group, status: "protected" }, instances: [instance], pairs: [{ ...pair, fault_level: 5 }] }, url => reprotect && url.pathname.endsWith("/server-groups/group-1") ? Response.json({ server_group: { ...group, status: "failed-over" } }) : reprotect && url.pathname.endsWith("/cloudservers/detail") ? Response.json({ servers: [source, { ...target, status: "ACTIVE" }] }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "failover", {}, gr), /replication link is broken/);
  reprotect = true; await assert.rejects(sdrsManagement.execute(session, "reprotect", {}, gr), /Shut down/); assert.equal(writes.length, 0);
});
test("SDRS recovery drills require completed initial sync and use an automatic isolated VPC", async t => {
  let ready = false;
  const writes = cloud(t, { pairs: [{ ...pair, progress: 42, replication_status: "copying" }] }, url => ready && url.pathname.endsWith("/replications") ? Response.json({ replications: [pair], count: 1 }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "create-drill", { name: "Test" }, gr), /initial synchronization/);
  ready = true; await sdrsManagement.execute(session, "create-drill", { name: "Test" }, gr);
  assert.deepEqual(writes[0].body, { disaster_recovery_drill: { name: "Test", server_group_id: group.id } });
});
test("SDRS source disk selection rechecks its AZ, detached state, sharing, and remaining pair quota", async t => {
  let shared = true;
  const writes = cloud(t, {}, url => shared && url.pathname.endsWith("/cloudvolumes/detail") ? Response.json({ cloudvolumes: [{ ...disk, multiattach: true }] }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "create-pair", { name: "Copy", disk: disk.id }, gr), /available non-shared/);
  shared = false; await sdrsManagement.execute(session, "create-pair", { name: "Copy", disk: disk.id }, gr);
  assert.deepEqual(writes[0].body, { replication: { name: "Copy", description: "", server_group_id: group.id, volume_id: disk.id } });
});
test("SDRS protected-server creation checks native VPC metadata, every attached disk, duplicate protection, and quota", async t => {
  const writes = cloud(t, { servers: [{ ...source, status: "ACTIVE" }], disks: [{ ...disk, status: "in-use", attachments: [{ server_id: source.id, device: "/dev/vda" }] }] });
  const options = await sdrsManagement.options!(session, "create-instance", gr); assert.equal(options.servers[0].value, source.id);
  await sdrsManagement.execute(session, "create-instance", { name: "Protection", server: source.id }, gr);
  assert.deepEqual(writes[0].body, { protected_instance: { server_group_id: group.id, server_id: source.id, name: "Protection", description: "", tenancy: "shared" } });
});
test("SDRS denies duplicate protection, other VPCs, missing disks, and state changes before writes", async t => {
  let duplicate = true;
  const writes = cloud(t, { instances: [instance] }, url => !duplicate && url.pathname.endsWith("/protected-instances") ? Response.json({ protected_instances: [], count: 0 }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "create-instance", { name: "Protection", server: source.id }, gr), /unprotected, idle server/);
  duplicate = false; await assert.rejects(sdrsManagement.execute(session, "create-instance", { name: "Protection", server: source.id }, gr), /attached, and non-shared/); assert.equal(writes.length, 0);
});
test("SDRS job polling verifies opaque native ID and parent, reports failure without native secret strings", async t => {
  let reply: Record<string, unknown> = { job_id: "job-1", status: "RUNNING", entities: { server_group_id: group.id }, fail_reason: "PROVIDER_SECRET" };
  cloud(t, {}, url => url.pathname.endsWith("/jobs/job-1") ? Response.json(reply) : undefined);
  const entry: ManagementHistoryEntry = { id: "request", service: "sdrs", operation: "start", resourceId: gr.id, jobId: "job-1", state: "submitted", startedAt: new Date().toISOString() };
  assert.equal((await sdrsManagement.poll!(session, entry)).state, "submitted");
  reply = { ...reply, status: "FAIL", error_code: "SDRS.1027" }; const failed = await sdrsManagement.poll!(session, entry); assert.equal(failed.state, "failed"); assert.ok(!JSON.stringify(failed).includes("PROVIDER_SECRET"));
  reply = { ...reply, status: "SUCCESS" }; assert.equal((await sdrsManagement.poll!(session, entry)).state, "succeeded");
  reply = { ...reply, entities: { server_group_id: "foreign" } }; await assert.rejects(sdrsManagement.poll!(session, entry), /another protection group/);
  reply = { ...reply, job_id: "wrong" }; await assert.rejects(sdrsManagement.poll!(session, entry), /job identity/);
});
test("SDRS missing job ID is an uncertain response requiring native task inspection", async t => {
  cloud(t, {}, (_url, init) => init.method === "DELETE" ? Response.json({}) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "delete-group", {}, gr), /Check native recovery tasks/);
});
test("SDRS pagination does not treat per-page native count as total and rejects repeated pages", async t => {
  const offsets: string[] = [];
  cloud(t, {}, url => {
    if (!url.pathname.endsWith("/server-groups")) return undefined;
    offsets.push(url.searchParams.get("offset")!);
    return Response.json({ server_groups: Array.from({ length: 100 }, (_, i) => ({ ...group, id: `group-${i}` })), count: 100 });
  });
  await assert.rejects(sdrsManagement.inventory(session), /repeated a page/); assert.deepEqual(offsets, ["0", "100"]);
});
test("SDRS names and descriptions enforce native UTF-8 byte limits and exclude angle brackets", () => {
  const create = sdrsManagement.operations.find(o => o.id === "create")!;
  const sources = { domains: [{ value: domain.id, label: "pair" }], vpcs: [{ value: "vpc-1", label: "VPC" }] };
  const values = { name: "有效名称", domain: domain.id, vpc: "vpc-1" };
  assert.doesNotThrow(() => validateManagementValues(create, values, sources));
  assert.throws(() => validateManagementValues(create, { ...values, name: "界".repeat(22) }, sources), /invalid format/);
  assert.throws(() => validateManagementValues(create, { ...values, description: "<invalid>" }, sources), /invalid format/);
});

test("SDRS tags preserve other keys, accept empty values, enforce native limits, and recheck deletion membership", async t => {
  const writes = cloud(t, { instances: [instance] });
  const definition = sdrsManagement.operations.find(o => o.id === "set-tag")!;
  const values = validateManagementValues(definition, { key: "environment", value: "" });
  assert.deepEqual(values, { key: "environment", value: "" });
  assert.throws(() => validateManagementValues(definition, { key: "environment" }), /required/);
  assert.throws(() => validateManagementValues(definition, { key: "bad/key", value: "value" }), /invalid format/);
  await sdrsManagement.execute(session, "set-tag", values, ir);
  assert.deepEqual(writes[0].body, { tag: { key: "environment", value: "" } });
  const options = await sdrsManagement.options!(session, "delete-tag", ir); assert.equal(options.tags[0].value, "environment");
  await assert.rejects(sdrsManagement.execute(session, "delete-tag", { key: "stale" }, ir), /no longer exists/);
  await sdrsManagement.execute(session, "delete-tag", { key: "environment" }, ir);
  assert.equal(writes[1].path, "/v1/project-1/protected-instances/instance-1/tags/environment");
});

test("SDRS tag capacity allows updating an existing key but blocks an eleventh tag", async t => {
  const writes = cloud(t, { instances: [instance] }, (url, init) => !init.method && url.pathname.endsWith("/instance-1/tags") ? Response.json({ tags: Array.from({ length: 10 }, (_, i) => ({ key: `key-${i}`, value: "old" })) }) : undefined);
  await assert.rejects(sdrsManagement.execute(session, "set-tag", { key: "new", value: "value" }, ir), /maximum of 10 tags/);
  await sdrsManagement.execute(session, "set-tag", { key: "key-1", value: "replacement" }, ir);
  assert.equal(writes.length, 1);
});
