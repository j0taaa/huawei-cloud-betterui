import {
  downloadObsObject,
  encodeObsObjectKey,
  getObsBucket,
  getObsObjectDetail,
  parseObsObjects,
  readObsPreview,
  uploadObsObject,
} from "@/lib/huawei/services/obs";
import assert from "node:assert/strict";
import { test } from "node:test";
import { session } from "./fixtures/session";

const bucketsXml =
  "<ListAllMyBucketsResult><Buckets><Bucket><Name>test-bucket</Name><Location>sa-brazil-1</Location></Bucket></Buckets></ListAllMyBucketsResult>";
const credentialResponse = () =>
  Response.json({
    credential: {
      access: "test-access",
      secret: "test-secret",
      securitytoken: "test-security-token",
    },
  });
const objectXml = (key: string, truncate = false, next?: string) =>
  `<ListBucketResult><EncodingType>url</EncodingType><IsTruncated>${truncate}</IsTruncated><Contents><Key>${encodeURIComponent(key)}</Key><Size>4</Size><ETag>&quot;etag&quot;</ETag></Contents>${next ? `<NextMarker>${encodeURIComponent(next)}</NextMarker>` : ""}</ListBucketResult>`;

test("OBS decodes URL-encoded listing keys exactly once and keeps raw XML keys intact", () => {
  for (const key of [
    " hello world ",
    "dir/ação+汉字.txt",
    "literal%2Fname.txt",
    "100%.txt",
    "a&b.txt",
  ]) {
    assert.equal(parseObsObjects(objectXml(key)).objects[0].key, key);
    assert.equal(new URLSearchParams({ key }).get("key"), key);
    assert.equal(
      encodeObsObjectKey(key).split("/").map(decodeURIComponent).join("/"),
      key,
    );
  }
  assert.equal(
    parseObsObjects(
      "<Contents><Key>literal%2Fname.txt</Key><Size>0</Size></Contents>",
    ).objects[0].key,
    "literal%2Fname.txt",
  );
  assert.deepEqual(
    parseObsObjects(
      "<EncodingType>url</EncodingType><CommonPrefixes><Prefix>dir%20one%2F</Prefix></CommonPrefixes>",
    ).commonPrefixes,
    ["dir one/"],
  );
});

test("OBS bucket listings traverse NextMarker without double encoding the marker", async (t) => {
  const firstKey = "dir/literal%2F +ação.txt";
  const markers: (string | null)[] = [];
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.includes("securitytokens")) return credentialResponse();
    if (url.hostname.startsWith("test-bucket.")) {
      markers.push(url.searchParams.get("marker"));
      assert.equal(url.searchParams.get("max-keys"), "1000");
      return new Response(
        markers.length === 1
          ? objectXml(firstKey, true, firstKey)
          : objectXml("last.txt"),
      );
    }
    return new Response(bucketsXml);
  });
  const bucket = await getObsBucket(session, "test-bucket");
  assert.deepEqual(markers, [null, firstKey]);
  assert.deepEqual(
    bucket?.objects.map((object) => object.key),
    [firstKey, "last.txt"],
  );
  assert.equal(bucket?.objectCount, 2);
  assert.equal(bucket?.isTruncated, false);
});

test("OBS uses the last decoded key when a truncated listing omits NextMarker", async (t) => {
  let pages = 0;
  const key = " spaces %2F ";
  t.mock.method(globalThis, "fetch", async (input: string) => {
    const url = new URL(input);
    if (url.pathname.includes("securitytokens")) return credentialResponse();
    if (!url.hostname.startsWith("test-bucket."))
      return new Response(bucketsXml);
    if (++pages === 1) return new Response(objectXml(key, true));
    assert.equal(url.searchParams.get("marker"), key);
    return new Response(objectXml("last"));
  });
  assert.equal((await getObsBucket(session, "test-bucket"))?.objects.length, 2);
});

test("OBS repeated markers fail rather than silently truncating inventory", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("securitytokens")
      ? credentialResponse()
      : input.includes("test-bucket.obs.")
        ? new Response(objectXml("same", true, "same"))
        : new Response(bucketsXml),
  );
  await assert.rejects(
    getObsBucket(session, "test-bucket"),
    /repeated its pagination marker/,
  );
});

test("downloads, previews, and uploads keep percent signs, Unicode, and surrounding spaces", async (t) => {
  const key = " folder/literal%2F +ação.txt ";
  for (const action of ["download", "preview", "upload"] as const) {
    let credentialCalls = 0;
    let objectCalls = 0;
    t.mock.method(
      globalThis,
      "fetch",
      async (input: string, init: RequestInit) => {
        const url = new URL(input);
        if (url.pathname.includes("securitytokens")) {
          credentialCalls++;
          return credentialResponse();
        }
        if (!url.hostname.startsWith("test-bucket."))
          return new Response(bucketsXml);
        objectCalls++;
        assert.equal(url.pathname, `/${encodeObsObjectKey(key)}`);
        assert.equal(decodeURIComponent(url.pathname.slice(1)), key);
        assert.match(
          new Headers(init.headers).get("Authorization")!,
          /^OBS test-access:/,
        );
        if (action === "upload") {
          assert.equal(init.method, "PUT");
          assert.ok(init.body instanceof File);
        }
        if (action === "preview")
          assert.equal(new Headers(init.headers).get("Range"), "bytes=0-65535");
        return new Response("body", {
          headers: { "content-type": "text/plain", "content-length": "4" },
        });
      },
    );
    if (action === "download") {
      const response = await downloadObsObject(session, "test-bucket", key);
      assert.equal(response.filename, "literal%2F +ação.txt ");
      assert.equal(await new Response(response.body).text(), "body");
    } else if (action === "preview") {
      const object = await getObsObjectDetail(session, "test-bucket", key);
      assert.equal(object.key, key);
      assert.equal(object.previewText, "body");
    } else
      await uploadObsObject(
        session,
        "test-bucket",
        key,
        new File(["body"], "name.txt"),
      );
    assert.equal(credentialCalls, 1);
    assert.equal(objectCalls, 1);
    t.mock.restoreAll();
  }
});

test("OBS preview enforces a byte limit when the server ignores Range", async () => {
  let cancelled = false;
  const response = new Response(
    new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode("x".repeat(100_000)));
      },
      cancel() {
        cancelled = true;
      },
    }),
  );
  assert.equal((await readObsPreview(response)).length, 65_536);
  assert.equal(cancelled, true);
});

test("OBS object failures stay visible and empty keys are rejected", async (t) => {
  t.mock.method(globalThis, "fetch", async (input: string) =>
    input.includes("securitytokens")
      ? credentialResponse()
      : input.includes("test-bucket.obs.")
        ? new Response("<Message>Object denied</Message>", { status: 403 })
        : new Response(bucketsXml),
  );
  await assert.rejects(
    getObsObjectDetail(session, "test-bucket", "key"),
    /403.*permission denied/,
  );
  await assert.rejects(
    uploadObsObject(session, "test-bucket", "", new File([], "name")),
    /Object key is required/,
  );
});
