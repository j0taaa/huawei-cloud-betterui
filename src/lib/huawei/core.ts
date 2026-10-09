import "server-only";
export { serviceEndpoint, type ServiceKey } from "@/lib/huawei/endpoints";
export {
  huaweiFetch,
  huaweiAccountFetch,
  huaweiList,
  parseError,
} from "@/lib/huawei/http";
export {
  loadAcrossProjects,
  sessionProjects,
  projectForId,
} from "@/lib/huawei/projects";
export {
  asArray,
  asString,
  firstString,
  firstIp,
  numberWithUnit,
} from "@/lib/huawei/parsers";
export function asRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
export function formatBytes(value: unknown) {
  const bytes = Number(value ?? 0);

  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "-";
  }

  const units = ["B", "KiB", "MiB", "GiB", "TiB"];
  let amount = bytes;
  let unitIndex = 0;

  while (amount >= 1024 && unitIndex < units.length - 1) {
    amount /= 1024;
    unitIndex += 1;
  }

  return `${amount.toFixed(amount >= 10 || unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}
