import assert from "node:assert/strict";
import { test } from "node:test";
import { CloudLoadError, combineCloudLoads } from "@/lib/huawei/errors";
import { getRdsInstanceDetails } from "@/lib/huawei-cloud/rds";
import { getMonthlyResourceCost } from "@/lib/huawei-cloud/billing";
import { getDcsRedisInstance } from "@/lib/huawei-cloud/dcs";
import { getDmsKafkaInstance } from "@/lib/huawei-cloud/dms-kafka";
import { listImagesForProject } from "@/lib/huawei-cloud/ims";
import { getObsBucket, deleteObsObject, encodeObsObjectKey } from "@/lib/huawei-cloud/obs";
import { project, session } from "./fixtures/session";

test("combined inventory failures preserve the page's object shape and usable rows", async () => {
  await assert.rejects(
    combineCloudLoads(
      {
        disks: Promise.resolve([{ id: "disk-1" }]),
        snapshots: Promise.reject(new CloudLoadError("snapshot permission denied", [{ id: "snapshot-1" }])),
      },
      { disks: [], snapshots: [] },
    ),
    (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      assert.deepEqual(error.partialData, { disks: [{ id: "disk-1" }], snapshots: [{ id: "snapshot-1" }] });
      assert.match(error.message, /snapshots: snapshot permission denied/);
      return true;
    },
  );
});

test("RDS detail failures preserve the local workspace shape and rich upstream inventory fields", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.includes("denied-project")) return Response.json({ error_msg: "permission denied" }, { status: 403 });
    if (input.includes("/backups")) return Response.json({ backups: [] });
    return Response.json({ instances: [{ id: "db-1", name: "database", volume: { size: 120, type: "ULTRAHIGH" }, nodes: [{ id: "node-1", role: "master" }] }] });
  });
  await assert.rejects(
    getRdsInstanceDetails({ ...session, projects: [project, { ...project, projectId: "denied-project" }] }, "db-1"),
    (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      const data = error.partialData as { backups: unknown[]; instance: { storage: string; nodes: { id: string }[] } };
      assert.deepEqual(data.backups, []);
      assert.equal(data.instance.storage, "120 GB");
      assert.equal(data.instance.nodes[0].id, "node-1");
      return true;
    },
  );
});

test("monthly resource costs use the account token and include later fee pages", async (t) => {
  const offsets: string[] = [];
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    assert.equal(new Headers(init.headers).get("X-Auth-Token"), "account-token");
    assert.equal(url.searchParams.get("resource_id"), "resource-1");
    offsets.push(url.searchParams.get("offset")!);
    return Response.json({ currency: "USD", total_count: 2, fee_records: [{ resource_id: "resource-1", amount: offsets.length === 1 ? 5 : 7 }] });
  });
  const cost = await getMonthlyResourceCost({ ...session, accountToken: "account-token" }, "resource-1");
  assert.equal(cost.amount, 12);
  assert.equal(cost.recordCount, 2);
  assert.deepEqual(offsets, ["0", "1"]);
});

test("OBS folder browsing preserves literal percent signs while paging within the selected prefix", async (t) => {
  const prefix = "literal%2F/";
  let page = 0;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.includes("securitytokens")) return Response.json({ credential: { access: "access", secret: "secret", securitytoken: "security-token" } });
    if (!url.hostname.startsWith("bucket.")) return new Response("<Buckets><Bucket><Name>bucket</Name><Location>sa-brazil-1</Location></Bucket></Buckets>");
    assert.equal(url.searchParams.get("prefix"), prefix);
    assert.equal(url.searchParams.get("delimiter"), "/");
    page++;
    if (page === 2) assert.equal(url.searchParams.get("marker"), prefix + "first");
    const key = prefix + (page === 1 ? "first" : "second");
    return new Response(`<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>${page === 1}</IsTruncated><Contents><Key>${encodeURIComponent(key)}</Key><Size>4</Size></Contents>${page === 1 ? `<NextMarker>${encodeURIComponent(key)}</NextMarker>` : ""}</ListBucketResult>`);
  });
  const bucket = await getObsBucket(session, "bucket", prefix);
  assert.equal(bucket?.currentPrefix, prefix);
  assert.equal(bucket?.objects.length, 2);
  assert.equal(bucket?.objects[1].key, prefix + "second");
});

test("OBS deletion retains raw object keys and upstream request signing", async (t) => {
  const key = "literal%2F/ação + file.txt";
  let deleted = false;
  t.mock.method(globalThis, "fetch", async (input: string, init: RequestInit) => {
    const url = new URL(input);
    if (url.pathname.includes("securitytokens")) return Response.json({ credential: { access: "access", secret: "secret", securitytoken: "security-token" } });
    if (!url.hostname.startsWith("bucket.")) return new Response("<Buckets><Bucket><Name>bucket</Name><Location>sa-brazil-1</Location></Bucket></Buckets>");
    assert.equal(init.method, "DELETE");
    assert.equal(url.pathname, "/" + encodeObsObjectKey(key));
    assert.match(new Headers(init.headers).get("Authorization")!, /^OBS access:/);
    deleted = true;
    return new Response(null, { status: 204 });
  });
  await deleteObsObject(session, "bucket", key);
  assert.equal(deleted, true);
});

test("direct database lookups allow other-project 404s while preserving permission failures", async (t) => {
  let denied = false;
  t.mock.method(globalThis, "fetch", async (input: string) => {
    if (input.includes("other-project")) return Response.json({ error_msg: denied ? "permission denied" : "not found" }, { status: denied ? 403 : 404 });
    return Response.json({ id: "instance-1", name: "database", status: "RUNNING" });
  });
  const multi = { ...session, projects: [project, { ...project, projectId: "other-project" }] };
  for (const loader of [getDcsRedisInstance, getDmsKafkaInstance]) {
    denied = false;
    assert.equal((await loader(multi, "instance-1"))?.id, "instance-1");
    denied = true;
    await assert.rejects(loader(multi, "instance-1"), (error: unknown) => {
      assert.ok(error instanceof CloudLoadError);
      assert.match(error.message, /permission denied/);
      assert.equal((error.partialData as { id: string }).id, "instance-1");
      return true;
    });
  }
});

test("partial image catalogs remain errors with usable images rather than successful empty inventories", async (t) => {
  let calls = 0;
  t.mock.method(globalThis, "fetch", async () => ++calls === 1
    ? Response.json({ images: [{ id: "image-1", name: "OS image" }] })
    : Response.json({ error_msg: "catalog denied" }, { status: 403 }));
  await assert.rejects(listImagesForProject(project), (error: unknown) => {
    assert.ok(error instanceof CloudLoadError);
    assert.equal((error.partialData as { id: string }[])[0].id, "image-1");
    assert.match(error.message, /catalog denied/);
    return true;
  });
});
