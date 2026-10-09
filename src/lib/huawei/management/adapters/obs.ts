import "server-only";
import { isIP } from "node:net";
import { listObsBuckets, obsBucketConfigurationRequest, deleteEmptyObsBucket } from "@/lib/huawei/services/obs";
import { HuaweiApiError } from "@/lib/huawei/http";
import { xmlTag } from "@/lib/huawei/parsers";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { ManagementAdapter } from "../types";
const namespace = 'xmlns="http://obs.region.myhuaweicloud.com/doc/2015-06-30/"';
const escape = (value: string) => value.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&apos;");
const storageClass = { key: "class", label: "Default storage class", type: "select" as const, required: true, defaultValue: "STANDARD", choices: [{ value: "STANDARD", label: "Standard" }, { value: "WARM", label: "Infrequent access" }, { value: "COLD", label: "Archive" }] };
export const obsManagement: ManagementAdapter = {
  title: "Object Storage Service",
  operations: [
    { id: "create", label: "Create bucket", kind: "create", description: "Create a private object bucket in the selected project's region. Bucket names must be globally unique.", fields: [{ key: "name", label: "Bucket name", required: true, min: 3, max: 63, pattern: "^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$" }, storageClass], impact: "Object storage, requests and data transfer can incur charges. Archive data needs restoration before it can be downloaded." },
    { id: "configuration", label: "View bucket configuration", kind: "inspect", description: "Read versioning, storage class, lifecycle, CORS and bucket policy. Missing settings are shown explicitly; permission errors remain visible.", fields: [] },
    { id: "versioning", label: "Configure object versioning", kind: "update", description: "Enable or suspend versioning for future object writes. Existing versions remain stored.", fields: [{ key: "status", label: "Versioning", type: "select", required: true, choices: [{ value: "Enabled", label: "Enabled" }, { value: "Suspended", label: "Suspended" }] }], confirmation: true, impact: "Versioning retains earlier object versions and can increase storage charges. Suspending it changes protection for future writes." },
    { id: "storage", label: "Change default storage class", kind: "update", description: "Choose the default class for new objects. Existing objects keep their own storage class.", fields: [storageClass], impact: "New objects follow this class's minimum storage duration, retrieval and request pricing." },
    { id: "acl", label: "Configure bucket access", kind: "update", description: "Replace bucket ACL grants with private or public-read canned permissions. Object ACLs and bucket policies are separate.", fields: [{ key: "acl", label: "Bucket permissions", type: "select", required: true, defaultValue: "private", choices: [{ value: "private", label: "Private" }, { value: "public-read", label: "Public read" }] }], confirmation: true, impact: "Public read permits unauthenticated bucket listing. This replaces existing bucket ACL grants; object ACLs and bucket policies can independently grant access." },
    { id: "lifecycle", label: "Set object expiration rule", kind: "update", description: "Replace lifecycle rules with one expiration rule for a prefix. Use an empty prefix to cover the whole bucket.", fields: [{ key: "prefix", label: "Object prefix", max: 1024, allowEmpty: true }, { key: "days", label: "Expiration age (days)", type: "number", required: true, min: 1, max: 36500 }], confirmation: true, impact: "Existing lifecycle rules are replaced. Objects matching this prefix expire automatically after the selected age; expiration can permanently remove data." },
    { id: "delete-lifecycle", label: "Remove lifecycle rules", kind: "action", description: "Remove every configured lifecycle rule from this bucket.", fields: [], confirmation: true, impact: "Automatic expiration and storage transitions stop; retained objects can increase storage charges." },
    { id: "cors", label: "Configure browser access (CORS)", kind: "update", description: "Replace CORS rules with one rule for the origins and methods listed here. CORS does not grant object permissions.", fields: [{ key: "origins", label: "Allowed origins", type: "list", required: true, max: 10, help: "One HTTP/HTTPS origin per line, or * for any origin." }, { key: "methods", label: "Allowed methods", type: "list", source: "methods", required: true, max: 5 }, { key: "maxAge", label: "Preflight cache age (seconds)", type: "number", required: true, min: 0, max: 86400, defaultValue: 300 }], confirmation: true, impact: "Existing CORS rules are replaced, changing which browser applications can access authorized objects." },
    { id: "delete-cors", label: "Remove browser access rules", kind: "action", description: "Delete the bucket's CORS configuration.", fields: [], confirmation: true, impact: "Browser applications depending on cross-origin access can stop working." },
    { id: "policy", label: "Edit bucket policy", kind: "update", description: "Replace the OBS JSON bucket policy. Resource targets must stay inside the selected bucket.", fields: [{ key: "policy", label: "OBS bucket policy JSON", type: "textarea", required: true, max: 20480, maxBytes: 20480 }], confirmation: true, impact: "This replaces the entire bucket policy and can grant public access, delegate access or deny existing users. Review every principal, action and condition." },
    { id: "delete-policy", label: "Remove bucket policy", kind: "action", description: "Delete the bucket policy. Object and bucket ACLs still apply.", fields: [], confirmation: true, impact: "Permissions granted or denied by this policy no longer apply." },
    { id: "delete", label: "Delete empty bucket", kind: "delete", description: "Remove an empty bucket. Huawei also rejects buckets with stored versions or incomplete uploads.", fields: [], confirmation: true, impact: "The bucket name becomes available for other accounts to allocate." },
  ],
  inventory: async (session) => (await listObsBuckets(session)).filter((bucket) => bucket.location === session.region).map((bucket) => ({ id: bucket.name, name: bucket.name })),
  options: async (_session, operation): Promise<Record<string, ManagementChoice[]>> => operation === "cors" ? { methods: ["GET", "HEAD", "PUT", "POST", "DELETE"].map((value) => ({ value, label: value })) } : {},
  invalidationKeys: () => [cloudCacheKeys.listObsBuckets],
  execute: async (session, operation, values, resource) => {
    if (operation === "create") {
      const name = String(values.name);
      if (isIP(name) || name.includes("..") || name.includes(".-") || name.includes("-.")) throw new ManagementInputError("Bucket names cannot be IP addresses or contain adjacent periods and hyphens.");
      await obsBucketConfigurationRequest(session, name, "PUT", undefined, `<CreateBucketConfiguration ${namespace}><Location>${escape(session.region)}</Location></CreateBucketConfiguration>`, { "x-obs-acl": "private", "x-obs-storage-class": String(values.class) });
      return { message: "Private OBS bucket created.", resourceId: name };
    }
    const name = resource!.id;
    if (operation === "delete") { await deleteEmptyObsBucket(session, name); return { message: "Empty bucket deleted." }; }
    if (operation === "configuration") {
      const subresources = ["versioning", "storageClass", "lifecycle", "cors", "policy"] as const;
      const facts = await Promise.all(subresources.map(async (subresource) => {
        try {
          const value = await obsBucketConfigurationRequest(session, name, "GET", subresource);
          return { label: subresource, value: subresource === "versioning" ? xmlTag(value, "Status", "Not enabled") : subresource === "storageClass" ? xmlTag(value, "StorageClass", "Not reported") : value || "Not configured" };
        } catch (error) { if (error instanceof HuaweiApiError && error.status === 404) return { label: subresource, value: "Not configured" }; throw error; }
      }));
      return { message: "Bucket configuration loaded.", facts };
    }
    if (operation === "versioning") await obsBucketConfigurationRequest(session, name, "PUT", "versioning", `<VersioningConfiguration ${namespace}><Status>${values.status}</Status></VersioningConfiguration>`);
    else if (operation === "storage") await obsBucketConfigurationRequest(session, name, "PUT", "storageClass", `<StorageClass ${namespace}>${values.class}</StorageClass>`);
    else if (operation === "acl") await obsBucketConfigurationRequest(session, name, "PUT", "acl", undefined, { "x-obs-acl": String(values.acl) });
    else if (operation === "lifecycle") await obsBucketConfigurationRequest(session, name, "PUT", "lifecycle", `<LifecycleConfiguration ${namespace}><Rule><ID>betterui-expiration</ID><Prefix>${escape(String(values.prefix ?? ""))}</Prefix><Status>Enabled</Status><Expiration><Days>${values.days}</Days></Expiration></Rule></LifecycleConfiguration>`);
    else if (operation === "cors") {
      for (const origin of values.origins as string[]) {
        if (origin === "*") continue;
        let parsed: URL; try { parsed = new URL(origin); } catch { throw new ManagementInputError("Enter HTTP or HTTPS origins without paths."); }
        if (!["http:", "https:"].includes(parsed.protocol) || parsed.origin !== origin || parsed.username || parsed.password) throw new ManagementInputError("Enter HTTP or HTTPS origins without credentials, paths, queries or fragments.");
      }
      await obsBucketConfigurationRequest(session, name, "PUT", "cors", `<CORSConfiguration ${namespace}><CORSRule>${(values.origins as string[]).map((origin) => `<AllowedOrigin>${escape(origin)}</AllowedOrigin>`).join("")}${(values.methods as string[]).map((method) => `<AllowedMethod>${method}</AllowedMethod>`).join("")}<AllowedHeader>*</AllowedHeader><MaxAgeSeconds>${values.maxAge}</MaxAgeSeconds></CORSRule></CORSConfiguration>`);
    } else if (operation === "policy") {
      let policy: unknown; try { policy = JSON.parse(String(values.policy)); } catch { throw new ManagementInputError("Enter valid JSON for the OBS bucket policy."); }
      if (!policy || typeof policy !== "object" || Array.isArray(policy) || !("Statement" in policy) || !Array.isArray(policy.Statement) || !policy.Statement.length) throw new ManagementInputError("A bucket policy must contain a nonempty Statement array.");
      for (const statement of policy.Statement) {
        if (!statement || typeof statement !== "object" || !["Allow", "Deny"].includes(statement.Effect)) throw new ManagementInputError("Each policy statement needs an Allow or Deny effect.");
        const targets = Array.isArray(statement.Resource) ? statement.Resource : [statement.Resource];
        if (!targets.length || targets.some((target: unknown) => typeof target !== "string" || (target !== name && !target.startsWith(`${name}/`)))) throw new ManagementInputError("Every policy resource must be this bucket or an object path inside it.");
      }
      await obsBucketConfigurationRequest(session, name, "PUT", "policy", JSON.stringify(policy));
    } else if (["delete-lifecycle", "delete-cors", "delete-policy"].includes(operation)) await obsBucketConfigurationRequest(session, name, "DELETE", operation.slice(7) as "lifecycle" | "cors" | "policy");
    else throw new ManagementInputError("Unsupported object storage operation.");
    return { message: "OBS bucket configuration updated." };
  },
};
