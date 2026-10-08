import "server-only";

import { finishCloudLoad } from "@/lib/huawei/errors";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  numberWithUnit,
} from "@/lib/huawei/parsers";
import { loadAcrossProjects, sessionProjects } from "@/lib/huawei/projects";

export type FunctionGraphFunction = {
  codeFile: string;
  codeLink: string;
  codeSize: string;
  codeText: string;
  codeType: string;
  cpu: string;
  description: string;
  digest: string;
  handler: string;
  id: string;
  lastModified: string;
  memorySize: string;
  name: string;
  packageName: string;
  projectId: string;
  projectName: string;
  region: string;
  runtime: string;
  timeout: string;
  urn: string;
  version: string;
};

export async function listFunctionGraphFunctionsForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<{
    functions?: unknown[];
    next_marker?: string;
  }>(session, "fg", `/v2/${session.projectId}/fgs/functions?maxitems=400`, {
    items: ["functions"],
    kind: "marker",
    parameter: "marker",
    size: 400,
    next: ["next_marker"],
    total: ["count"],
  });

  return asArray(body.functions).map((item): FunctionGraphFunction => {
    const fn = asRecord(item);
    return parseFunctionGraphFunction(fn, session);
  });
}

export function parseFunctionGraphFunction(
  fn: Record<string, unknown>,
  session: HuaweiProjectSession,
): FunctionGraphFunction {
  const funcCode = asRecord(fn.func_code ?? fn.code);
  const codeFile = firstString(
    [fn.code_filename, funcCode.file, funcCode.code_filename],
    "",
  );
  const inlineCode = firstString(
    [
      fn.code_text,
      fn.codeText,
      fn.source_code,
      funcCode.code,
      funcCode.source_code,
    ],
    "",
  );
  const codeType = firstString([fn.code_type, fn.codeType, funcCode.type]);

  return {
    codeFile,
    codeLink: firstString([fn.code_url, funcCode.link, funcCode.location], ""),
    codeSize: numberWithUnit(fn.code_size, "bytes"),
    codeText: inlineCode,
    codeType,
    cpu: firstString([fn.cpu], "-"),
    description: asString(fn.description, ""),
    digest: firstString([fn.digest, fn.code_sha256, fn.code_digest], ""),
    handler: asString(fn.handler),
    id: firstString([
      fn.func_id,
      fn.id,
      fn.function_id,
      fn.function_urn,
      fn.func_urn,
    ]),
    lastModified: firstString([
      fn.last_modified,
      fn.updated_at,
      fn.created_time,
    ]),
    memorySize: numberWithUnit(fn.memory_size ?? fn.memorySize, "MB"),
    name: firstString([fn.func_name, fn.name, fn.function_name]),
    packageName: firstString([fn.package, fn.package_name, fn.app], "default"),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    runtime: firstString([fn.runtime, fn.runtime_id]),
    timeout: numberWithUnit(fn.timeout, "s"),
    urn: firstString([fn.func_urn, fn.function_urn, fn.urn, fn.id]),
    version: firstString([fn.version, fn.func_version], "latest"),
  };
}

export async function getFunctionGraphFunctionForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const decodedId = decodeURIComponent(id);
  const functions = await listFunctionGraphFunctionsForProject(session);
  const summary = functions.find(
    (fn) =>
      fn.id === id ||
      fn.id === decodedId ||
      fn.urn === id ||
      fn.urn === decodedId ||
      fn.name === id ||
      fn.name === decodedId,
  );

  if (!summary) {
    return null;
  }

  const functionUrn = encodeURIComponent(summary.urn || summary.id);
  const [configResult, codeResult] = await Promise.allSettled([
    huaweiFetch<Record<string, unknown>>(
      session,
      "fg",
      `/v2/${session.projectId}/fgs/functions/${functionUrn}/config`,
    ),
    huaweiFetch<Record<string, unknown>>(
      session,
      "fg",
      `/v2/${session.projectId}/fgs/functions/${functionUrn}/code`,
    ),
  ]);
  const config = configResult.status === "fulfilled" ? configResult.value : {};
  const code = codeResult.status === "fulfilled" ? codeResult.value : {};
  const merged = {
    ...summary,
    ...config,
    func_code: asRecord(code.func_code ?? code.code),
    code_text: firstString(
      [code.code, code.code_text, code.source_code],
      summary.codeText,
    ),
    code_filename: firstString(
      [code.code_filename, code.file],
      summary.codeFile,
    ),
    code_size: firstString([code.code_size], summary.codeSize),
    code_type: firstString([code.code_type, code.type], summary.codeType),
    code_url: firstString(
      [code.code_url, code.link, code.location],
      summary.codeLink,
    ),
  };

  return finishCloudLoad(
    [configResult, codeResult],
    parseFunctionGraphFunction(merged, session),
    ["Function config", "Function code"],
  );
}

export async function listFunctionGraphFunctions(session: BetterUiSession) {
  return loadAcrossProjects(session, listFunctionGraphFunctionsForProject);
}

export async function getFunctionGraphFunction(
  session: BetterUiSession,
  id: string,
) {
  const results = await Promise.allSettled(
    sessionProjects(session).map((project) =>
      getFunctionGraphFunctionForProject(project, id),
    ),
  );

  return finishCloudLoad(
    results,
    results
      .filter(
        (
          result,
        ): result is PromiseFulfilledResult<FunctionGraphFunction | null> =>
          result.status === "fulfilled",
      )
      .map((result) => result.value)
      .find(Boolean) ?? null,
  );
}
