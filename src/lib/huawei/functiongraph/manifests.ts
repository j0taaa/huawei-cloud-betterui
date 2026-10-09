import { asRecord } from "@/lib/huawei/parsers";
import type { FunctionGraphFunction } from "@/lib/huawei/services/functiongraph.types";
export function defaultManifestType(fn: FunctionGraphFunction) {
  return /node/i.test(fn.runtime) ? "package.json" : "requirements.txt";
}

function normalizeDependencyVersion(
  manifestType: "package.json" | "requirements.txt",
  version: string,
) {
  const trimmed = version.trim();

  if (!trimmed) {
    return manifestType === "package.json" ? "latest" : "";
  }

  if (
    manifestType === "requirements.txt" &&
    !/^(==|>=|<=|~=|>|<|!=)/.test(trimmed)
  ) {
    return `==${trimmed}`;
  }

  return trimmed;
}

function updateRequirementsContent(
  content: string,
  name: string,
  version: string,
) {
  const normalized = normalizeDependencyVersion("requirements.txt", version);
  const nextLine = `${name}${normalized}`;
  const lines = content.trimEnd() ? content.trimEnd().split(/\r?\n/) : [];
  const dependencyPattern = new RegExp(
    `^\\s*${name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:\\s|[=<>~!]|$)`,
    "i",
  );
  let replaced = false;
  const nextLines = lines.map((line) => {
    if (!line.trim().startsWith("#") && dependencyPattern.test(line)) {
      replaced = true;
      return nextLine;
    }

    return line;
  });

  if (!replaced) {
    nextLines.push(nextLine);
  }

  return `${nextLines.join("\n")}\n`;
}

function updatePackageJsonContent(
  content: string,
  name: string,
  version: string,
) {
  const normalized = normalizeDependencyVersion("package.json", version);
  const parsed = content.trim()
    ? (JSON.parse(content) as Record<string, unknown>)
    : {};
  const dependencies = asRecord(parsed.dependencies);

  parsed.dependencies = {
    ...dependencies,
    [name]: normalized,
  };

  return `${JSON.stringify(parsed, null, 2)}\n`;
}

export function updateDependencyManifestContent(
  content: string,
  manifestType: "package.json" | "requirements.txt",
  name: string,
  version: string,
) {
  if (manifestType === "package.json") {
    return updatePackageJsonContent(content || "{}\n", name, version);
  }

  return updateRequirementsContent(content, name, version);
}
