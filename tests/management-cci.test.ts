import assert from "node:assert/strict";
import { test, type TestContext } from "node:test";
import { cciManagement } from "@/lib/huawei/management/adapters/cci";
import { listCciNamespacesForProject } from "@/lib/huawei/services/cci";
import { session } from "./fixtures/session";
const ns = { metadata: { uid: "ns-1", name: "apps", annotations: { "tenant.kubernetes.io/project-id": session.projectId, "tenant.kubernetes.io/domain-id": "domain-1" } }, status: { phase: "Active" } };
const resource = { id: "ns-1", name: "apps", status: "Active" };
const deployment = { metadata: { uid: "deploy-1", name: "web", namespace: "apps", resourceVersion: "42" }, spec: { replicas: 2, template: { metadata: { labels: { app: "web" } }, spec: { containers: [{ name: "web", image: "example/web:v1", env: [{ name: "MODE", value: "prod" }], resources: { limits: { cpu: "500m" } } }, { name: "sidecar", image: "example/sidecar:v1" }], imagePullSecrets: [{ name: "pull" }] } } } };
const network = { metadata: { uid: "net-1", name: "private", namespace: "apps" }, spec: { defaultNetwork: true }, status: { status: "Ready" } };
const configmap = { metadata: { uid: "cm-1", name: "settings", namespace: "apps", resourceVersion: "7", labels: { owner: "team" } }, data: { OLD: "old" }, binaryData: { BINARY: "YQ==" } };
const pull = { metadata: { uid: "sec-1", name: "pull", namespace: "apps" }, type: "kubernetes.io/dockerconfigjson", data: { ".dockerconfigjson": "DO-NOT-EXPOSE" } };
const collections: Record<string, unknown[]> = { deployments: [deployment], pods: [], replicasets: [], services: [], configmaps: [configmap], secrets: [pull], persistentvolumeclaims: [], horizontalpodautoscalers: [], networks: [network] };
function read(url: URL) {
  if (url.pathname === "/apis/cci/v2/namespaces") return { items: [ns], metadata: {} };
  if (url.pathname.endsWith("/subnets")) return { subnets: [{ id: "subnet-1", vpc_id: "vpc-1", neutron_network_id: "network-1", neutron_subnet_id: "neutron-subnet-1", name: "Subnet", cidr: "192.168.0.0/24" }] };
  if (url.pathname.endsWith("/security-groups")) return { security_groups: [{ id: "sg-1", name: "Web" }] };
  const collection = url.pathname.split("/").at(-1)!;
  if (Object.hasOwn(collections, collection)) return { items: collections[collection], metadata: {} };
  throw new Error(`Unexpected read ${url.pathname}`);
}
function cloud(t: TestContext, customize?: (url: URL) => unknown) {
  const writes: { path: string; method: string; body?: unknown; type: string | null }[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (!init.method) return Response.json(customize?.(url) ?? read(url));
    writes.push({ path: url.pathname, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined, type: new Headers(init.headers).get("Content-Type") });
    return Response.json({ metadata: { name: "new-ns", uid: "new-uid" } });
  });
  return writes;
}
test("CCI management maps project-owned namespaces without requesting Secret data", async t => {
  const writes = cloud(t, url => url.pathname === "/apis/cci/v2/namespaces" ? { items: [ns, { ...ns, metadata: { ...ns.metadata, uid: "foreign", annotations: { "tenant.kubernetes.io/project-id": "other" } } }] } : undefined);
  assert.deepEqual(await cciManagement.inventory(session), [resource]); assert.equal(writes.length, 0);
});
test("CCI creates a native 2.0 namespace and reports asynchronous acceptance", async t => {
  const writes = cloud(t); const result = await cciManagement.execute(session, "create", { name: "new-ns" });
  assert.equal(result.resourceId, "new-uid"); assert.equal(result.asynchronous, true);
  assert.deepEqual(writes[0].body, { apiVersion: "cci/v2", kind: "Namespace", metadata: { name: "new-ns" } });
  await assert.rejects(cciManagement.execute(session, "create", { name: "kube-system" }), /application namespace/);
});
test("CCI private networks use Neutron subnet IDs and freshly verified account/project metadata", async t => {
  const writes = cloud(t, url => url.pathname.endsWith("/networks") ? { items: [] } : undefined);
  await cciManagement.execute(session, "create-network", { name: "private", subnet: "subnet-1", securityGroup: "sg-1" }, resource);
  assert.deepEqual(writes[0].body, { apiVersion: "yangtse/v2", kind: "Network", metadata: { name: "private", namespace: "apps", annotations: { "yangtse.io/domain-id": "domain-1", "yangtse.io/project-id": session.projectId } }, spec: { defaultNetwork: true, networkType: "underlay_neutron", securityGroups: ["sg-1"], subnets: [{ subnetID: "neutron-subnet-1" }] } });
});
test("CCI deployment has fixed CPU/memory, private networking, and an owned image-pull Secret", async t => {
  const writes = cloud(t);
  const result = await cciManagement.execute(session, "create-deployment", { name: "web", image: "example/web:v2", replicas: 2, size: "500m:1024Mi", pullSecret: "pull" }, resource);
  const body = writes[0].body as typeof deployment;
  assert.equal(writes[0].path, "/apis/cci/v2/namespaces/apps/deployments"); assert.equal(result.asynchronous, true);
  assert.deepEqual(body.spec.template.spec.containers[0].resources, { requests: { cpu: "500m", memory: "1024Mi" }, limits: { cpu: "500m", memory: "1024Mi" } });
  assert.deepEqual(body.spec.template.spec.imagePullSecrets, [{ name: "pull" }]); assert.ok(!JSON.stringify(result).includes("DO-NOT-EXPOSE"));
});
test("CCI refuses deployment without a ready default network or with a foreign Secret", async t => {
  let missingNetwork = true;
  const writes = cloud(t, url => url.pathname.endsWith("/networks") && missingNetwork ? { items: [] } : url.pathname.endsWith("/secrets") ? { items: [{ ...pull, metadata: { ...pull.metadata, namespace: "other" } }] } : undefined);
  const values = { name: "web", image: "example/web:v2", replicas: 1, size: "500m:1024Mi", pullSecret: "pull" };
  await assert.rejects(cciManagement.execute(session, "create-deployment", values, resource), /Ready state/);
  missingNetwork = false; await assert.rejects(cciManagement.execute(session, "create-deployment", values, resource), /no longer belongs/);
  assert.equal(writes.length, 0);
});
test("CCI image rollouts preserve sidecars and container settings using revision-checked merge patch", async t => {
  const writes = cloud(t);
  await cciManagement.execute(session, "change-image", { container: JSON.stringify(["web", "web"]), image: "example/web:v2" }, resource);
  assert.equal(writes[0].type, "application/merge-patch+json"); assert.equal(writes[0].method, "PATCH");
  assert.deepEqual(writes[0].body, { metadata: { resourceVersion: "42" }, spec: { template: { spec: { containers: [{ ...deployment.spec.template.spec.containers[0], image: "example/web:v2" }, deployment.spec.template.spec.containers[1]] } } } });
  await assert.rejects(cciManagement.execute(session, "change-image", { container: JSON.stringify(["web", "foreign"]), image: "example/web:v2" }, resource), /no longer belongs/);
});
test("CCI scaling changes only replicas and deleting deployment uses the documented native DELETE", async t => {
  const writes = cloud(t); await cciManagement.execute(session, "scale", { deployment: "web", replicas: 0 }, resource);
  assert.deepEqual(writes[0].body, { metadata: { resourceVersion: "42" }, spec: { replicas: 0 } });
  await cciManagement.execute(session, "delete-deployment", { deployment: "web" }, resource);
  assert.equal(writes[1].method, "DELETE"); assert.equal(writes[1].body, undefined);
});
test("CCI blocks nonempty namespace and in-use network deletion", async t => {
  const writes = cloud(t);
  await assert.rejects(cciManagement.execute(session, "delete", {}, resource), /still contains deployments/);
  await assert.rejects(cciManagement.execute(session, "delete-network", { network: "private" }, resource), /Remove all pods and deployments/);
  assert.equal(writes.length, 0);
});
test("CCI empty namespace deletion checks storage claims and every known collection", async t => {
  let claims = true; const reads: string[] = [];
  const writes = cloud(t, url => { reads.push(url.pathname); return url.pathname.includes("/namespaces/apps/") ? { items: url.pathname.endsWith("/persistentvolumeclaims") && claims ? [{ metadata: { name: "data" } }] : [] } : undefined; });
  await assert.rejects(cciManagement.execute(session, "delete", {}, resource), /persistentvolumeclaims/);
  claims = false; await cciManagement.execute(session, "delete", {}, resource);
  assert.ok(reads.some(path => path.endsWith("/horizontalpodautoscalers"))); assert.ok(reads.some(path => path.includes("/yangtse/") && path.endsWith("/networks")));
  assert.equal(writes[0].path, "/apis/cci/v2/namespaces/apps"); assert.equal(writes[0].method, "DELETE");
});
test("CCI ConfigMap replacement preserves metadata/binary data and rejects non-string data", async t => {
  const writes = cloud(t);
  await cciManagement.execute(session, "update-configmap", { configmap: "settings", data: '{"MODE":"prod"}' }, resource);
  assert.deepEqual(writes[0].body, { apiVersion: "cci/v2", kind: "ConfigMap", metadata: configmap.metadata, data: { MODE: "prod" }, binaryData: configmap.binaryData });
  await assert.rejects(cciManagement.execute(session, "create-configmap", { name: "cfg", data: '{"MODE":1}' }, resource), /values must be strings/);
});
test("CCI Secrets send native base64 data without exposing values or encoded provider errors", async t => {
  const writes = cloud(t); const result = await cciManagement.execute(session, "create-secret", { name: "app-secret", key: "token", value: "private-value" }, resource);
  assert.ok(!JSON.stringify(result).includes("private-value")); assert.equal((writes[0].body as { data: { token: string } }).data.token, Buffer.from("private-value").toString("base64"));
  t.mock.method(globalThis, "fetch", async (_input: string, init: RequestInit) => !init.method ? Response.json({ items: [ns] }) : Response.json({ message: Buffer.from("private-value").toString("base64") }, { status: 403 }));
  await assert.rejects(cciManagement.execute(session, "create-secret", { name: "app-secret", key: "token", value: "private-value" }, resource), error => { assert.ok(!String(error).includes("cHJpdmF0ZS12YWx1ZQ==")); return true; });
});
test("CCI rejects foreign or terminating namespaces and embedded image credentials", async t => {
  let terminating = false;
  const writes = cloud(t, url => url.pathname === "/apis/cci/v2/namespaces" ? { items: terminating ? [{ ...ns, status: { phase: "Terminating" } }] : [] } : undefined);
  await assert.rejects(cciManagement.execute(session, "inspect", {}, resource), /no longer belongs/);
  terminating = true; await assert.rejects(cciManagement.execute(session, "inspect", {}, resource), /terminating/); assert.equal(writes.length, 0);
});
test("CCI inspection omits Secret and container environment data", async t => {
  cloud(t); const result = await cciManagement.execute(session, "inspect", {}, resource);
  assert.ok(result.facts?.some(fact => fact.label === "secrets" && fact.value === "pull"));
  assert.ok(!JSON.stringify(result).includes("DO-NOT-EXPOSE")); assert.ok(!JSON.stringify(result).includes("MODE"));
});
test("CCI 2.0 inventory tolerates unsupported older workload routes but preserves authorization failures", async t => {
  let denied = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input); const last = url.pathname.split("/").at(-1)!;
    if (["statefulsets", "jobs", "cronjobs"].includes(last)) return Response.json({ message: denied ? "denied" : "unsupported endpoint" }, { status: denied ? 403 : 404 });
    return Response.json(read(url));
  });
  assert.equal((await listCciNamespacesForProject(session))[0].name, "apps");
  denied = true; await assert.rejects(listCciNamespacesForProject(session), /denied/);
});

test("CCI deployment rejects credentials and URL syntax in image references before writes", async t => {
  const writes = cloud(t);
  for (const image of ["https://registry.example/app:v1", "user:password@registry.example/app:v1", "registry.example//app:v1"]) {
    await assert.rejects(cciManagement.execute(session, "create-deployment", { name: "web", image, replicas: 1, size: "500m:1024Mi" }, resource), /without URLs or embedded credentials/);
  }
  assert.equal(writes.length, 0);
});
