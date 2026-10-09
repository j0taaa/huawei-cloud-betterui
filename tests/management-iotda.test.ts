import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { after, test } from "node:test";
import { getManagementContext, runManagementOperation } from "@/lib/huawei/management";
import { listManagementHistory } from "@/lib/huawei/management/history";
import { session } from "./fixtures/session";
const directory = mkdtempSync(path.join(os.tmpdir(), "betterui-iotda-"));
process.env.BETTERUI_DATA_DIR = directory;
after(() => rm(directory, { recursive: true, force: true }));
const capabilities = [{ service_id: "thermostat", service_type: "temperature", properties: [{ property_name: "target", data_type: "decimal", method: "RW", min: "0", max: "100" }, { property_name: "observed", data_type: "decimal", method: "R" }], commands: [{ command_name: "setTarget", paras: [{ para_name: "target", data_type: "decimal", required: true, min: "0", max: "100" }] }] }];
function read(url: URL) {
  if (url.pathname.endsWith("/apps")) return { applications: [{ app_id: "app-1", app_name: "Home" }, { app_id: "app-2", app_name: "Factory" }] };
  if (url.pathname.endsWith("/products")) return { products: [{ product_id: "product-1", app_id: url.searchParams.get("app_id"), name: "Thermostat", protocol_type: "MQTT", description: "Product description" }] };
  if (url.pathname.endsWith("/products/product-1")) return { product_id: "product-1", app_id: url.searchParams.get("app_id"), name: "Thermostat", description: "Product description", protocol_type: "MQTT", service_capabilities: capabilities };
  if (url.pathname.endsWith("/devices")) return { devices: [{ device_id: "device-1", device_name: "Thermostat", node_id: "serial-1", product_id: "product-1", gateway_id: "device-1", node_type: "GATEWAY", status: "ONLINE" }] };
  if (url.pathname.endsWith("/devices/device-1")) return { device_id: "device-1", device_name: "Thermostat", product_id: "product-1", app_id: "app-1", gateway_id: "device-1", node_id: "serial-1", description: "Actual device description", auth_info: { auth_type: "SECRET", secret: "provider-secret-must-stay-hidden" } };
  if (url.pathname.endsWith("/devices/device-1/shadow")) return { shadow: [{ service_id: "thermostat", desired: { properties: { target: 20 } }, reported: { properties: { observed: 19 } }, version: 7 }] };
  throw Error(`Unexpected IoTDA read ${url}`);
}
const body = (operation: string, values: Record<string, unknown> = {}, resourceId = "device:device-1", confirmName = "Thermostat") => ({ requestId: randomUUID(), operation, projectId: session.projectId, resourceId, confirmName, acknowledgedImpact: true, values });
test("IoTDA product inventory preserves duplicate IDs in different resource spaces and refreshes metadata", async t => {
  t.mock.method(globalThis, "fetch", async (input: string) => Response.json(read(new URL(input))));
  const context = await getManagementContext(session, "iotda", session.projectId, "update-product", "product:app-1:product-1");
  assert.deepEqual(context.resources.filter(r => r.id.startsWith("product:")).map(r => r.id), ["product:app-1:product-1", "product:app-2:product-1"]);
  assert.equal(context.resources.find(r => r.id === "product:app-1:product-1")?.values?.description, "Product description");
  const device = await getManagementContext(session, "iotda", session.projectId, "update-device", "device:device-1");
  assert.equal(device.resources.find(r => r.id === "device:device-1")?.values?.description, "Actual device description");
  assert.ok(!JSON.stringify(device).includes("provider-secret"));
});
test("IoTDA registration pins the product's resource space and never saves authentication secrets", async t => {
  let sent: unknown; let target = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); target = new URL(input).pathname; sent = JSON.parse(String(init.body)); return Response.json({ device_id: "new-device", auth_info: { secret: "provider-generated-secret" } }); });
  const result = await runManagementOperation(session, "iotda", body("create-device", { name: "RoomSensor", product: "product:app-2:product-1", node: "serial-2", secret: "UserSecret123" }));
  assert.equal(target, "/v5/iot/project-1/devices");
  assert.deepEqual(sent, { app_id: "app-2", product_id: "product-1", node_id: "serial-2", device_name: "RoomSensor", description: "", auth_info: { auth_type: "SECRET", secret: "UserSecret123", secure_access: true, timeout: 0 } });
  assert.equal(result.resourceId, "device:new-device");
  assert.ok(!JSON.stringify(result).includes("provider-generated-secret"));
  assert.ok(!JSON.stringify(await listManagementHistory(session, "iotda")).includes("UserSecret123"));
});
test("IoTDA refuses a gateway in another resource space and forged products without writing", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (init.method) { writes++; return Response.json({}); } return Response.json(read(new URL(input))); });
  const values = { name: "Child", product: "product:app-2:product-1", node: "serial-2", secret: "UserSecret123", gateway: "device-1" };
  await assert.rejects(runManagementOperation(session, "iotda", body("create-device", values)), /same resource space/);
  await assert.rejects(runManagementOperation(session, "iotda", body("create-device", { ...values, product: "product:foreign:product-1" })), /not available/);
  assert.equal(writes, 0);
});
test("IoTDA product metadata update supplies app_id and preserves service model", async t => {
  let sent: unknown; let target = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); target = new URL(input).pathname; sent = JSON.parse(String(init.body)); return new Response(null, { status: 204 }); });
  await runManagementOperation(session, "iotda", body("update-product", { name: "Renamed", description: "" }, "product:app-2:product-1"));
  assert.equal(target, "/v5/iot/project-1/products/product-1");
  assert.deepEqual(sent, { app_id: "app-2", name: "Renamed", description: "" });
});
test("IoTDA model replacement rejects malformed and duplicate definitions before writing", async t => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({}); });
  const request = (model: unknown) => body("update-model", { model: JSON.stringify(model) }, "product:app-1:product-1", "Thermostat (Home)");
  await assert.rejects(runManagementOperation(session, "iotda", request({})), /array/);
  await assert.rejects(runManagementOperation(session, "iotda", request([...capabilities, ...capabilities])), /unique/);
  await assert.rejects(runManagementOperation(session, "iotda", request([{ ...capabilities[0], arbitrary: "value" }])), /unsupported field/);
  assert.equal(sent, undefined);
  await runManagementOperation(session, "iotda", request(capabilities));
  assert.deepEqual(sent, { app_id: "app-1", service_capabilities: capabilities });
});
test("IoTDA deletion refuses a product with devices and a gateway with children", async t => {
  let writes = 0;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    if (init.method) { writes++; return Response.json({}); }
    const url = new URL(input); const response = read(url);
    if (url.pathname.endsWith("/devices")) return Response.json({ devices: [...(response as { devices: unknown[] }).devices, { device_id: "child-1", product_id: "product-1", gateway_id: "device-1" }] });
    return Response.json(response);
  });
  await assert.rejects(runManagementOperation(session, "iotda", body("delete-product", {}, "product:app-1:product-1", "Thermostat (Home)")), /every device/);
  await assert.rejects(runManagementOperation(session, "iotda", body("delete-device")), /child devices/);
  assert.equal(writes, 0);
});
test("IoTDA command validates current model parameter names, types, bounds, and requirements", async t => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({ command_id: "command-1" }); });
  const request = (parameters: unknown) => body("send-command", { command: JSON.stringify(["thermostat", "setTarget"]), parameters: JSON.stringify(parameters) });
  await assert.rejects(runManagementOperation(session, "iotda", request({})), /required/);
  await assert.rejects(runManagementOperation(session, "iotda", request({ target: "20" })), /number/);
  await assert.rejects(runManagementOperation(session, "iotda", request({ target: 200 })), /limits/);
  await assert.rejects(runManagementOperation(session, "iotda", request({ target: 20, unrecognized: true })), /absent/);
  assert.equal(sent, undefined);
  const result = await runManagementOperation(session, "iotda", request({ target: 20 }));
  assert.deepEqual(sent, { service_id: "thermostat", command_name: "setTarget", paras: { target: 20 } });
  assert.equal(result.facts?.[0]?.value, "command-1");
});
test("IoTDA shadow uses flat desired properties and a fresh version and blocks read-only writes", async t => {
  let sent: unknown;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); sent = JSON.parse(String(init.body)); return Response.json({}); });
  await assert.rejects(runManagementOperation(session, "iotda", body("update-shadow", { service: "thermostat", properties: '{"observed":22}' })), /writable/);
  await runManagementOperation(session, "iotda", body("update-shadow", { service: "thermostat", properties: '{"target":22}' }));
  assert.deepEqual(sent, { shadow: [{ service_id: "thermostat", desired: { target: 22 }, version: 7 }] });
});
test("IoTDA secret reset uses action_id, omits returned secrets, and checks authentication mode", async t => {
  let sent: unknown; let query = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); query = new URL(input).search; sent = JSON.parse(String(init.body)); return Response.json({ secret: "provider-secret-returned" }); });
  const result = await runManagementOperation(session, "iotda", body("reset-secret", { secret: "NewSecret123", secretType: "PRIMARY", disconnect: true }));
  assert.equal(query, "?action_id=resetSecret"); assert.deepEqual(sent, { secret: "NewSecret123", secret_type: "PRIMARY", force_disconnect: true });
  assert.ok(!JSON.stringify(result).includes("provider-secret-returned"));
});
test("IoTDA inspection excludes secrets and freezing uses native POST", async t => {
  let target = "";
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => { if (!init.method) return Response.json(read(new URL(input))); target = new URL(input).pathname; assert.equal(init.method, "POST"); return new Response(null, { status: 204 }); });
  const detail = await runManagementOperation(session, "iotda", body("inspect-device"));
  assert.ok(!JSON.stringify(detail).includes("provider-secret"));
  await runManagementOperation(session, "iotda", body("freeze")); assert.equal(target, "/v5/iot/project-1/devices/device-1/freeze");
});
