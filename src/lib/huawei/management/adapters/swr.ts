import "server-only";
import { huaweiFetch } from "@/lib/huawei/http";
import { asArray, asRecord, firstString } from "@/lib/huawei/parsers";
import { listSwrRepositoriesForProject, listSwrTagsForProject } from "@/lib/huawei/services/swr";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { ManagementInputError, type ManagementChoice } from "@/lib/management-contract";
import type { BetterUiSession } from "@/lib/auth-session";
import type { ManagementAdapter } from "../types";

const category = { key: "category", label: "Category", type: "select" as const, required: true, defaultValue: "other", choices: ["app_server", "linux", "framework_app", "database", "lang", "other", "windows", "arm"].map((value) => ({ value, label: value.replaceAll("_", " ") })) };
const description = { key: "description", label: "Description", type: "textarea" as const, max: 1024, allowEmpty: true };
const visibility = { key: "public", label: "Public repository", type: "boolean" as const, required: true, defaultValue: false };
const impact = "Public repositories can be downloaded without authentication. Verify that every image layer is suitable for public access before enabling this setting.";

async function namespaces(session: BetterUiSession) {
  const result = await huaweiFetch<{ namespaces?: unknown[] }>(session, "swr", "/v2/manage/namespaces");
  return asArray(result.namespaces).map(asRecord).map((item) => firstString([item.name, item.namespace], "")).filter(Boolean);
}
function repositoryPath(namespace: string, name: string) {
  return `/v2/manage/namespaces/${encodeURIComponent(namespace)}/repos/${encodeURIComponent(name.replaceAll("/", "$"))}`;
}
export const swrManagement: ManagementAdapter = {
  title: "SWR Container Registry",
  operations: [
    { id: "create-namespace", label: "Create organization", kind: "create", description: "Create an organization in this region's basic-edition registry.", fields: [{ key: "name", label: "Organization name", required: true, max: 64, pattern: "^[a-z](?:[a-z0-9]|[._-][a-z0-9]|__[a-z0-9])*$" }] },
    { id: "delete-namespace", label: "Delete organization", kind: "delete", resourcePrefixes: ["namespace:"], description: "Delete an empty organization. Delete or migrate its repositories first.", fields: [], confirmation: true, impact: "The organization and its registry access configuration are removed." },
    { id: "create-repository", label: "Create image repository", kind: "create", description: "Create a repository in an organization you can currently access. Push images using Docker or an OCI client.", fields: [{ key: "namespace", label: "Organization", type: "select", required: true, source: "namespaces" }, { key: "name", label: "Repository name", required: true, max: 128, pattern: "^[a-z0-9](?:[a-z0-9]|[./_-][a-z0-9]|__[a-z0-9])*$" }, category, description, visibility], impact },
    { id: "update-repository", label: "Configure repository", kind: "update", resourcePrefixes: ["repository:"], description: "Change repository visibility, category and description.", fields: [category, description, visibility], confirmation: true, impact },
    { id: "delete-repository", label: "Delete image repository", kind: "delete", resourcePrefixes: ["repository:"], description: "Permanently remove this repository and its images.", fields: [], confirmation: true, impact: "All image versions are removed. New deployments using these images will fail to pull them." },
    { id: "tags", label: "View image versions", kind: "inspect", resourcePrefixes: ["repository:"], description: "List tags, digests and pull commands for this repository.", fields: [] },
    { id: "delete-tag", label: "Delete image version", kind: "action", resourcePrefixes: ["repository:"], description: "Delete one tag from this repository after checking current versions.", fields: [{ key: "tag", label: "Image tag", type: "select", required: true, source: "tags" }], confirmation: true, impact: "Deployments that reference this tag cannot pull it after deletion." },
  ],
  inventory: async (session) => {
    const [organizations, repos] = await Promise.all([namespaces(session), listSwrRepositoriesForProject(session)]);
    return [...organizations.map((name) => ({ id: `namespace:${name}`, name })), ...repos.map((repo) => ({ id: `repository:${repo.id}`, name: `${repo.namespace}/${repo.name}`, values: { namespace: repo.namespace, repository: repo.name, description: repo.description, public: repo.isPublic, category: repo.category } }))];
  },
  options: async (session, operation, resource): Promise<Record<string, ManagementChoice[]>> => {
    if (operation === "create-repository") return { namespaces: (await namespaces(session)).map((name) => ({ value: name, label: name })) };
    if (operation === "delete-tag" && resource?.values) return { tags: (await listSwrTagsForProject(session, String(resource.values.namespace), String(resource.values.repository))).map((tag) => ({ value: tag.name, label: `${tag.name} · ${tag.digest}` })) };
    return {};
  },
  invalidationKeys: (resource) => [cloudCacheKeys.listSwrRepositories, ...(resource?.id.startsWith("repository:") ? [cloudCacheKeys.swrRepository(resource.id.slice(11))] : [])],
  execute: async (session, operation, values, resource) => {
    if (operation === "create-namespace") { await huaweiFetch(session, "swr", "/v2/manage/namespaces", { method: "POST", body: JSON.stringify({ namespace: values.name }) }); return { message: "Registry organization created.", resourceId: `namespace:${values.name}` }; }
    if (operation === "delete-namespace") {
      const name = resource!.id.slice(10);
      if ((await listSwrRepositoriesForProject(session)).some((repo) => repo.namespace === name)) throw new ManagementInputError("Remove the organization's repositories before deleting it.", 409);
      await huaweiFetch(session, "swr", `/v2/manage/namespaces/${encodeURIComponent(name)}`, { method: "DELETE" }); return { message: "Registry organization deleted." };
    }
    if (operation === "create-repository") {
      const namespace = String(values.namespace);
      if (!(await namespaces(session)).includes(namespace)) throw new ManagementInputError("The organization no longer exists.", 404);
      await huaweiFetch(session, "swr", `/v2/manage/namespaces/${encodeURIComponent(namespace)}/repos`, { method: "POST", body: JSON.stringify({ repository: values.name, is_public: values.public, category: values.category, description: values.description ?? "" }) });
      return { message: "Image repository created. Push images with an authenticated Docker or OCI client." };
    }
    const namespace = String(resource?.values?.namespace ?? ""), repository = String(resource?.values?.repository ?? "");
    if (!namespace || !repository || !resource?.id.startsWith("repository:")) throw new ManagementInputError("Select an image repository.");
    const path = repositoryPath(namespace, repository);
    if (operation === "tags" || operation === "delete-tag") {
      const tags = await listSwrTagsForProject(session, namespace, repository);
      if (operation === "tags") return { message: `${tags.length} image versions loaded.`, facts: tags.map((tag) => ({ label: `${tag.name} · ${tag.digest}`, value: `docker pull ${tag.pullPath}` })) };
      if (!tags.some((tag) => tag.name === values.tag)) throw new ManagementInputError("The image tag no longer exists in this repository.", 404);
      await huaweiFetch(session, "swr", `${path}/tags/${encodeURIComponent(String(values.tag))}`, { method: "DELETE" });
    } else if (operation === "update-repository") await huaweiFetch(session, "swr", path, { method: "PATCH", body: JSON.stringify({ is_public: values.public, category: values.category, description: values.description ?? "" }) });
    else if (operation === "delete-repository") await huaweiFetch(session, "swr", path, { method: "DELETE" });
    else throw new ManagementInputError("Unsupported registry operation.");
    return { message: "Registry operation completed." };
  },
};
