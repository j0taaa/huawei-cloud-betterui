import * as huawei from "@/lib/huawei-cloud";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { sessionCacheScope } from "@/lib/huawei/result";
import {
  searchServices,
  searchableServices,
  serviceCatalog,
} from "@/lib/service-catalog";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";
import { project, session } from "./fixtures/session";

test("every available catalog entry has a route and participates in command search", () => {
  const shortNames = new Set<string>();
  for (const item of Object.values(serviceCatalog).flat()) {
    assert.equal(
      shortNames.has(item.shortName),
      false,
      `Duplicate catalog item ${item.shortName}`,
    );
    shortNames.add(item.shortName);
    if (!item.href) continue;
    const pathname = item.href.split(/[?#]/, 1)[0];
    assert.ok(
      existsSync(join(process.cwd(), "src/app", pathname, "page.tsx")),
      `Missing route for ${item.shortName}: ${item.href}`,
    );
    assert.ok(
      searchableServices.some(
        (service) =>
          service.shortName === item.shortName && service.href === item.href,
      ),
    );
  }
});

test("service search retains aliases, is case-insensitive, and returns catalog metadata", () => {
  assert.ok(
    searchServices("  VIRTUAL MACHINE ").some(
      (item) => item.shortName === "ECS",
    ),
  );
  assert.ok(searchServices("s3").some((item) => item.shortName === "OBS"));
  assert.ok(
    searchServices("migration").some((item) => item.shortName === "SMS"),
  );
  const ecs = searchServices("ECS").find((item) => item.shortName === "ECS")!;
  assert.equal(
    ecs.description,
    serviceCatalog.Compute.find((item) => item.shortName === "ECS")!
      .description,
  );
});

test("all inventory keys retain an exported loader prefix and allow cache schema versions", () => {
  for (const [key, value] of Object.entries(cloudCacheKeys)) {
    if (key.startsWith("list")) {
      assert.equal(
        typeof (huawei as Record<string, unknown>)[key],
        "function",
        `Missing loader ${key}`,
      );
      assert.equal(typeof value, "string");
      assert.equal((value as string).split("-")[0], key);
    }
  }
  assert.equal(cloudCacheKeys.ecs("id"), "ecs-instance-v2:id");
  assert.equal(
    cloudCacheKeys.obsObject("bucket", "literal%2F name"),
    "obs-object:bucket:literal%2F name",
  );
});

test("session cache scope changes with users, accounts, and project/region sets", () => {
  const scope = sessionCacheScope(session);
  for (const change of [
    { username: "other" },
    { userId: "other" },
    { accountName: "other" },
    { projects: [{ ...project, projectId: "other" }] },
    { projects: [{ ...project, region: "other" }] },
  ]) {
    assert.notEqual(scope, sessionCacheScope({ ...session, ...change }));
  }
  assert.equal(
    scope,
    sessionCacheScope({ ...session, token: "rotated-token" }),
  );
});
