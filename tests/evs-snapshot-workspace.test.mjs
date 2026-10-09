import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { test } from "node:test";

const root = process.cwd();
const readSource = (path) => readFileSync(join(root, path), "utf8");

test("EVS exposes a dedicated snapshot inventory workspace", () => {
  const pagePath = "src/app/services/evs/snapshots/page.tsx";
  const evsPage = readSource("src/app/services/evs/page.tsx");

  assert.equal(existsSync(join(root, pagePath)), true);
  assert.match(evsPage, /href="\/services\/evs\/snapshots"/);

  const snapshotPage = readSource(pagePath);
  assert.match(snapshotPage, /listEvsSnapshots/);
  assert.match(snapshotPage, /EvsSnapshotsTable/);
  assert.match(snapshotPage, /CreateEvsSnapshotButton/);
});

test("EVS snapshot inventory supports searchable pagination and bulk actions", () => {
  const table = readSource("src/components/evs-snapshots-table.tsx");
  const dataTable = readSource("src/components/data-table.tsx");

  assert.match(table, /<DataTable/);
  assert.match(table, /searchPlaceholder="Search snapshots/);
  assert.match(dataTable, /defaultPageSizeOptions = \[10, 25, 50, 100\]/);
  assert.match(dataTable, /pageSizeOptions\[1\].*25/);
  assert.match(dataTable, /filteredItems\.slice\(pageStart, pageEnd\)/);
  assert.match(table, /BulkDeleteEvsSnapshotsButton/);
  assert.match(table, /CreateEvsDiskFromSnapshotButton/);
  assert.match(table, /RollbackEvsSnapshotButton/);
  assert.match(table, /DeleteEvsSnapshotButton/);
});

test("disk creation validates snapshot ownership and minimum size server-side", () => {
  const route = readSource("src/app/api/cloud/evs/disks/route.ts");

  assert.match(route, /listEvsSnapshots\(session\)/);
  assert.match(
    route,
    /snapshots\.find\(\(item\) => item\.id === input\.snapshotId\)/,
  );
  assert.match(route, /EVS snapshot was not found/);
  assert.match(route, /input\.projectId !== snapshot\.projectId/);
  assert.match(route, /input\.sizeGb < snapshot\.rawSizeGb/);
  assert.match(route, /input\.projectId = snapshot\.projectId/);
});

test("Huawei EVS create request carries the selected snapshot", () => {
  const evs = readSource("src/lib/huawei/services/evs.ts");
  const actions = readSource("src/components/evs-disk-actions.tsx");

  assert.match(evs, /snapshot_id: input\.snapshotId/);
  assert.match(evs, /rawSizeGb/);
  assert.match(actions, /snapshotId: snapshot\.id/);
  assert.match(actions, /method: "POST"/);
  assert.match(actions, /\/api\/cloud\/evs\/disks/);
});

test("EVS disk details expose service-owned resource tabs", () => {
  const page = readSource("src/app/services/evs/[id]/page.tsx");

  for (const tab of [
    "overview",
    "snapshots",
    "backups",
    "monitoring",
    "tags",
    "activity",
  ]) {
    assert.match(page, new RegExp(`id: "${tab}"`));
  }

  assert.match(page, /activeTab === "monitoring"[\s\S]*?getEvsMonitoring/);
  assert.match(page, /activeTab === "backups"[\s\S]*?listCbrBackups/);
  assert.match(page, /activeTab === "activity"[\s\S]*?listCtsTraces/);
  assert.match(page, /activeTab === "overview"[\s\S]*?<OverviewTab/);
  assert.match(page, /ExportEvsSnapshotsButton/);
});

test("EVS monitoring uses the documented Cloud Eye contract", () => {
  const evs = readSource("src/lib/huawei/services/evs.ts");

  assert.match(evs, /namespace: "SYS\.EVS"/);
  assert.match(evs, /name: "disk_name"/);
  assert.match(evs, /disk_device_read_bytes_rate/);
  assert.match(evs, /disk_device_write_bytes_rate/);
  assert.match(evs, /disk_device_read_requests_rate/);
  assert.match(evs, /disk_device_write_requests_rate/);
  assert.match(evs, /batch-query-metric-data/);
});

test("manual EVS backups are guarded and create CBR checkpoints", () => {
  const cbr = readSource("src/lib/huawei/services/cbr.ts");
  const routePath = "src/app/api/cloud/evs/disks/[id]/backup/route.ts";
  const route = readSource(routePath);

  assert.equal(existsSync(join(root, routePath)), true);
  assert.match(cbr, /export async function createCbrCheckpoint/);
  assert.match(cbr, /`\/v3\/\$\{project\.projectId\}\/checkpoints`/);
  assert.match(cbr, /vault_id: input\.vaultId/);
  assert.match(cbr, /resources: \[input\.resourceId\]/);
  assert.match(
    route,
    /vault\.resources\.find\(\(item\) => item\.id === disk\.id\)/,
  );
  assert.match(route, /resource\.type !== "OS::Cinder::Volume"/);
  assert.match(route, /item\.id === vaultId && item\.projectId === projectId/);
  assert.match(route, /createCbrCheckpoint/);
});

test("EVS snapshot export produces escaped CSV client-side", () => {
  const actions = readSource("src/components/evs-detail-actions.tsx");

  assert.match(actions, /export function ExportEvsSnapshotsButton/);
  assert.match(actions, /replaceAll\('\"', '\"\"'\)/);
  assert.match(actions, /text\/csv;charset=utf-8/);
  assert.match(actions, /anchor\.download = fileName/);
});
