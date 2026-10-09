import "server-only";
import { ManagementInputError } from "@/lib/management-contract";

// Current native UpdateFunctionConfig request fields. Read-only code links and URNs never enter the write body.
export const functionConfigKeys = ["func_name", "runtime", "timeout", "handler", "memory_size", "gpu_memory", "gpu_type", "user_data", "encrypted_user_data", "xrole", "app_xrole", "description", "func_vpc", "peering_cidr", "mount_config", "strategy_config", "custom_image", "extend_config", "initializer_handler", "initializer_timeout", "pre_stop_handler", "pre_stop_timeout", "ephemeral_storage", "enterprise_project_id", "log_config", "network_controller", "is_stateful_function", "enable_dynamic_memory", "enable_auth_in_header", "domain_names", "restore_hook_handler", "restore_hook_timeout", "heartbeat_handler", "enable_class_isolation", "enable_lts_log", "lts_custom_tag", "user_data_encrypt_kms_key_id"] as const;

function containsMaskedValue(value: unknown): boolean {
  if (typeof value === "string") return /\*{4,}|^<redacted>$|^\[redacted\]$/i.test(value);
  if (Array.isArray(value)) return value.some(containsMaskedValue);
  if (value && typeof value === "object") return Object.values(value).some(containsMaskedValue);
  return false;
}

export function preserveFunctionGraphConfiguration(current: Record<string, unknown>, changes: Record<string, unknown>) {
  if (typeof current.func_name !== "string" || !current.func_name || typeof current.runtime !== "string" || !current.runtime || !Number.isSafeInteger(current.timeout) || !Number.isSafeInteger(current.memory_size)) throw new ManagementInputError("Huawei returned an incomplete function configuration; no update was sent.", 409);
  if (!Object.hasOwn(current, "user_data") && !Object.hasOwn(current, "encrypted_user_data") && !Object.hasOwn(changes, "user_data") && !Object.hasOwn(changes, "encrypted_user_data")) throw new ManagementInputError("The function's environment settings were not returned and cannot be preserved; no update was sent.", 409);
  const payload: Record<string, unknown> = {};
  for (const key of functionConfigKeys) {
    const value = Object.hasOwn(changes, key) ? changes[key] : current[key];
    if (containsMaskedValue(value)) throw new ManagementInputError("The function's private settings were returned masked and cannot be preserved; no update was sent.", 409);
    if (value !== undefined) payload[key] = value;
  }
  return payload;
}
