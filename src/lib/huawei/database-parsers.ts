import "server-only";

import type { HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  firstString,
  numberWithUnit,
} from "@/lib/huawei/parsers";
import type { GaussDbInstance } from "@/lib/huawei/services/gaussdb";

export function nodeCount(value: unknown) {
  return asArray(value).length || Number(value ?? 0) || 0;
}

export function firstIpFromValues(values: unknown[]) {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return value;
    }

    const array = asArray(value);
    if (array.length) {
      const match = array.find(
        (item) => typeof item === "string" && item.trim(),
      );
      if (typeof match === "string") {
        return match;
      }
    }
  }

  return "-";
}

export function backupWindow(value: unknown) {
  const strategy = asRecord(value);
  return firstString(
    [strategy.start_time, strategy.period, strategy.keep_days],
    "-",
  );
}

export function parseRelationalDbInstance(
  instance: unknown,
  session: HuaweiProjectSession,
): GaussDbInstance {
  const item = asRecord(instance);
  const datastore = asRecord(item.datastore);
  const volume = asRecord(item.volume);
  const backupStrategy = item.backup_strategy ?? item.backupStrategy;

  return {
    availabilityZone: firstString(
      [item.az_code, item.availability_zone, item.availability_zone_mode],
      "-",
    ),
    backupWindow: backupWindow(backupStrategy),
    datastore:
      [datastore.type, datastore.version].filter(Boolean).join(" ") || "-",
    id: firstString([item.id, item.instance_id]),
    mode: firstString([item.mode, item.ha_mode, item.instance_mode], "-"),
    name: firstString([item.name, item.instance_name, item.id]),
    nodes: nodeCount(item.nodes ?? item.node_count),
    port: String(item.port ?? item.db_port ?? "-"),
    privateIp: firstIpFromValues([
      item.private_ips,
      item.private_ip,
      item.private_ip_address,
    ]),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    status: firstString([item.status, item.instance_status], "UNKNOWN"),
    storage: numberWithUnit(
      volume.size ?? item.volume_size ?? item.storage_size,
      "GB",
    ),
    type: firstString([item.type, item.instance_type, item.flavor_ref], "-"),
  };
}
