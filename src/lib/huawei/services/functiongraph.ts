import { huaweiCesFetch } from "@/lib/huawei/ces-http";
import {
  downloadFunctionGraphCodeLink,
  functionGraphFetchWithHeaders,
} from "@/lib/huawei/functiongraph/transport";
import {
  defaultManifestType,
  updateDependencyManifestContent,
} from "@/lib/huawei/functiongraph/manifests";
import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";
import { huaweiList } from "@/lib/huawei/http";
import "server-only";
import { Buffer } from "node:buffer";
import {
  buildZipPayload,
  readZipPackage,
  isZipPayload,
} from "@/lib/functiongraph/package";
import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  asArray,
  asRecord,
  asString,
  firstString,
  huaweiFetch,
  loadAcrossProjects,
  numberWithUnit,
  projectForId,
  sessionProjects,
} from "@/lib/huawei/core";
import type {
  FunctionGraphCode,
  FunctionGraphDependencyInventoryItem,
  FunctionGraphFunction,
  FunctionGraphLogs,
  FunctionGraphInvokeResult,
  FunctionGraphMonitoring,
  FunctionGraphMonitoringMetric,
  FunctionGraphTrigger,
  FunctionGraphTriggerInventoryItem,
} from "@/lib/huawei/services/functiongraph.types";
import { getMonthlyResourceCost } from "@/lib/huawei/resource-cost";

export type CreateFunctionGraphFunctionInput = {
  code: string;
  description?: string;
  handler: string;
  memorySize: number;
  name: string;
  packageName: string;
  projectId?: string;
  runtime: string;
  timeout: number;
};

export type InvokeFunctionGraphFunctionInput = {
  event: unknown;
  logType?: "tail";
  projectId?: string;
};

export type UpdateFunctionGraphCodeInput = {
  codeFilename?: string;
  codePayload: string;
  codeType?: "inline" | "zip";
  projectId?: string;
};

export type UpdateFunctionGraphConfigInput = {
  appXrole?: string;
  customImageConfig?: unknown;
  description?: string;
  domainNamesConfig?: unknown;
  enableAuthInHeader?: boolean;
  enableLtsLog?: boolean;
  encryptedUserData?: string;
  enterpriseProjectId?: string;
  ephemeralStorage?: number;
  extendConfig?: unknown;
  funcVpcConfig?: unknown;
  handler?: string;
  initializerHandler?: string;
  initializerTimeout?: number;
  logConfig?: unknown;
  memorySize?: number;
  mountConfig?: unknown;
  name?: string;
  networkController?: unknown;
  projectId?: string;
  runtime?: string;
  strategyConcurrency?: number;
  strategyConfig?: unknown;
  timeout?: number;
  userData?: string;
  xrole?: string;
};

export type FunctionGraphTriggerInput = {
  eventData?: unknown;
  eventTypeCode?: string;
  projectId?: string;
  triggerStatus?: string;
  triggerTypeCode: string;
};

export type UpdateFunctionGraphTriggerInput = {
  eventData?: unknown;
  projectId?: string;
  triggerStatus?: string;
  triggerTypeCode: string;
};

export type AddFunctionGraphDependencyInput = {
  dependencyName: string;
  manifestType?: "package.json" | "requirements.txt";
  projectId?: string;
  version?: string;
};

type FunctionGraphMetricCandidate = {
  dimensions: Array<{ name: string; value: string }>;
  metricName: string;
  namespace: string;
  statistic: "average" | "max" | "min" | "sum";
  unit: string;
};

function configString(value: unknown) {
  if (value === undefined || value === null) {
    return "";
  }

  if (typeof value === "string") {
    return value;
  }

  if (Array.isArray(value) && value.length === 0) {
    return "";
  }

  if (
    typeof value === "object" &&
    !Array.isArray(value) &&
    Object.keys(asRecord(value)).length === 0
  ) {
    return "";
  }

  return JSON.stringify(value, null, 2);
}

function baseFunctionGraphUrn(value: string) {
  if (!value.startsWith("urn:") || !value.includes(":function:")) {
    return value;
  }

  const [prefix, suffix] = value.split(":function:");
  const parts = suffix.split(":");

  if (parts.length >= 3) {
    return `${prefix}:function:${parts.slice(0, 2).join(":")}`;
  }

  return value;
}

function normalizeFunctionGraphId(value: string) {
  return baseFunctionGraphUrn(value);
}

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
  const funcVpc = asRecord(fn.func_vpc);
  const strategyConfig = asRecord(fn.strategy_config);
  const codeFile = firstString(
    [fn.code_filename, fn.filename, funcCode.code_filename, funcCode.filename],
    "",
  );
  const codePayload = firstString(
    [
      fn.code_payload,
      fn.code_package,
      fn.code_body,
      fn.file,
      funcCode.file,
      funcCode.code_package,
      funcCode.code_body,
    ],
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

  const rawId = firstString([
    fn.func_id,
    fn.funcId,
    fn.id,
    fn.function_id,
    fn.functionId,
    fn.function_urn,
    fn.functionUrn,
    fn.func_urn,
    fn.funcUrn,
  ]);
  const rawUrn = firstString([
    fn.func_urn,
    fn.funcUrn,
    fn.function_urn,
    fn.functionUrn,
    fn.urn,
    fn.id,
  ]);

  return {
    appXrole: firstString([fn.app_xrole, fn.appXrole], "-"),
    codeFile,
    codeLink: firstString([fn.code_url, funcCode.link, funcCode.location], ""),
    codePayload,
    codeSize: numberWithUnit(fn.code_size ?? fn.codeSize, "bytes"),
    codeText: inlineCode,
    codeType,
    cpu: firstString([fn.cpu], "-"),
    description: asString(fn.description, ""),
    digest: firstString(
      [fn.digest, fn.code_sha256, fn.codeDigest, fn.code_digest],
      "",
    ),
    domainNamesConfig: configString(fn.domain_names ?? fn.domainNames),
    enableAuthInHeader: firstString(
      [String(fn.enable_auth_in_header ?? fn.enableAuthInHeader ?? "")],
      "-",
    ),
    enableLtsLog: firstString(
      [String(fn.enable_lts_log ?? fn.enableLtsLog ?? "")],
      "-",
    ),
    encryptedUserData: firstString(
      [fn.encrypted_user_data, fn.encryptedUserData],
      "-",
    ),
    enterpriseProjectId: firstString(
      [fn.enterprise_project_id, fn.enterpriseProjectId],
      "-",
    ),
    ephemeralStorage: numberWithUnit(
      fn.ephemeral_storage ?? fn.ephemeralStorage,
      "MB",
    ),
    extendConfig: configString(fn.extend_config ?? fn.extendConfig),
    funcVpcConfig: configString(fn.func_vpc ?? fn.funcVpc),
    handler: asString(fn.handler),
    id: normalizeFunctionGraphId(rawId),
    initializerHandler: firstString(
      [fn.initializer_handler, fn.initializerHandler],
      "-",
    ),
    initializerTimeout: numberWithUnit(
      fn.initializer_timeout ?? fn.initializerTimeout,
      "s",
    ),
    logConfig: configString(fn.log_config ?? fn.logConfig),
    lastModified: firstString([
      fn.last_modified,
      fn.lastModified,
      fn.updated_at,
      fn.updatedAt,
      fn.created_time,
      fn.createdTime,
    ]),
    memorySize: numberWithUnit(fn.memory_size ?? fn.memorySize, "MB"),
    mountConfig: configString(fn.mount_config ?? fn.mountConfig),
    name: firstString([
      fn.func_name,
      fn.funcName,
      fn.name,
      fn.function_name,
      fn.functionName,
    ]),
    networkController: configString(
      fn.network_controller ?? fn.networkController,
    ),
    packageName: firstString(
      [fn.package, fn.package_name, fn.packageName, fn.app],
      "default",
    ),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    reservedInstances: firstString(
      [String(fn.reserved_instance_count ?? "")],
      "0",
    ),
    resourceId: firstString([fn.resource_id, fn.resourceId], ""),
    runtime: firstString([fn.runtime, fn.runtime_id, fn.runtimeId]),
    serviceUrn: firstString([fn.service_urn, fn.serviceUrn], "-"),
    customImageConfig: configString(fn.custom_image ?? fn.customImage),
    strategyConfig: configString(fn.strategy_config ?? fn.strategyConfig),
    strategyConcurrency: firstString(
      [String(strategyConfig.concurrency ?? "")],
      "-",
    ),
    timeout: numberWithUnit(fn.timeout, "s"),
    urn: baseFunctionGraphUrn(rawUrn),
    userData: firstString(
      [fn.user_data, fn.userData, fn.encrypted_user_data, fn.encryptedUserData],
      "-",
    ),
    version: firstString([fn.version, fn.func_version], "latest"),
    vpcId: firstString([funcVpc.vpc_id, funcVpc.vpc_name], "-"),
    xrole: firstString([fn.xrole], "-"),
  };
}

function parseFunctionGraphTrigger(
  trigger: Record<string, unknown>,
): FunctionGraphTrigger {
  const eventData = trigger.event_data ?? trigger.eventData;

  return {
    createdAt: firstString(
      [trigger.created_time, trigger.createdTime, trigger.created_at],
      "",
    ),
    eventData: configString(eventData),
    eventTypeCode: firstString(
      [trigger.event_type_code, trigger.eventTypeCode],
      "-",
    ),
    id: firstString([trigger.trigger_id, trigger.triggerId, trigger.id]),
    name: firstString(
      [
        trigger.name,
        asRecord(eventData).name,
        asRecord(eventData).bucket,
        asRecord(eventData).path,
        asRecord(eventData).queue_id,
        asRecord(eventData).queueId,
      ],
      "-",
    ),
    status: firstString(
      [trigger.trigger_status, trigger.triggerStatus, trigger.status],
      "-",
    ),
    triggerTypeCode: firstString(
      [trigger.trigger_type_code, trigger.triggerTypeCode, trigger.type],
      "-",
    ),
    updatedAt: firstString(
      [trigger.updated_time, trigger.updatedTime, trigger.updated_at],
      "",
    ),
  };
}

function monitoringWindow(timeframe: string) {
  const now = Date.now();

  if (timeframe === "1h") {
    return {
      from: now - 60 * 60 * 1000,
      period: "60",
      timeframe: "1h",
      to: now,
    };
  }

  if (timeframe === "24h") {
    return {
      from: now - 24 * 60 * 60 * 1000,
      period: "3600",
      timeframe: "24h",
      to: now,
    };
  }

  if (timeframe === "7d") {
    return {
      from: now - 7 * 24 * 60 * 60 * 1000,
      period: "86400",
      timeframe: "7d",
      to: now,
    };
  }

  if (timeframe === "30d") {
    return {
      from: now - 30 * 24 * 60 * 60 * 1000,
      period: "86400",
      timeframe: "30d",
      to: now,
    };
  }

  return {
    from: now - 6 * 60 * 60 * 1000,
    period: "300",
    timeframe: "6h",
    to: now,
  };
}

function functionGraphMetricKey(candidate: FunctionGraphMetricCandidate) {
  return [
    candidate.namespace,
    candidate.metricName,
    candidate.statistic,
    candidate.dimensions
      .map((dimension) => `${dimension.name}:${dimension.value}`)
      .join(","),
  ].join(":");
}

function functionGraphMetricDimensions(fn: FunctionGraphFunction) {
  const packageFunction = `${fn.packageName}-${fn.name}`;
  const values = [
    { name: "package-functionname", value: packageFunction },
    { name: "function_name", value: fn.name },
    { name: "func_name", value: fn.name },
    { name: "function_urn", value: fn.urn || fn.id },
    { name: "func_urn", value: fn.urn || fn.id },
    { name: "function_id", value: fn.id },
  ];

  return values.filter(
    (dimension) => dimension.value && dimension.value !== "-",
  );
}

async function listFunctionGraphCesMetricCandidates(
  session: HuaweiProjectSession,
  fn: FunctionGraphFunction,
  definitions: Array<{
    metricName: string;
    statistic: FunctionGraphMetricCandidate["statistic"];
    unit: string;
  }>,
) {
  const expectedValues = new Set(
    functionGraphMetricDimensions(fn).map((dimension) => dimension.value),
  );
  const params = new URLSearchParams({
    limit: "1000",
    namespace: "SYS.FunctionGraph",
  });

  const body = await huaweiCesFetch<{ metrics?: unknown[] }>(
    session,
    `/V1.0/${session.projectId}/metrics?${params.toString()}`,
  );

  return asArray(body.metrics).flatMap(
    (metric): FunctionGraphMetricCandidate[] => {
      const item = asRecord(metric);
      const metricName = asString(item.metric_name);
      const definition = definitions.find(
        (candidate) => candidate.metricName === metricName,
      );

      if (!definition) {
        return [];
      }

      const dimensions = asArray(item.dimensions)
        .map((dimension) => {
          const record = asRecord(dimension);
          return {
            name: asString(record.name),
            value: asString(record.value),
          };
        })
        .filter((dimension) => dimension.name && dimension.value);

      if (
        !dimensions.length ||
        !dimensions.some((dimension) => expectedValues.has(dimension.value))
      ) {
        return [];
      }

      return [
        {
          dimensions,
          metricName,
          namespace: asString(item.namespace, "SYS.FunctionGraph"),
          statistic: definition.statistic,
          unit: definition.unit,
        },
      ];
    },
  );
}

function parseLogConfig(value: string) {
  try {
    const parsed = JSON.parse(value || "{}");
    return typeof parsed === "object" && parsed !== null
      ? asRecord(parsed)
      : {};
  } catch {
    return {};
  }
}

async function getFunctionGraphCesMetricBatch(
  session: HuaweiProjectSession,
  candidates: FunctionGraphMetricCandidate[],
  timeframe: string,
) {
  const window = monitoringWindow(timeframe);
  const body = await huaweiCesFetch<{ metrics?: unknown[] }>(
    session,
    `/V1.0/${session.projectId}/batch-query-metric-data`,
    {
      body: JSON.stringify({
        filter: candidates[0]?.statistic ?? "average",
        from: window.from,
        metrics: candidates.map((candidate) => ({
          dimensions: candidate.dimensions,
          metric_name: candidate.metricName,
          namespace: candidate.namespace,
        })),
        period: window.period,
        to: window.to,
      }),
      method: "POST",
    },
  );

  return new Map<string, FunctionGraphMonitoringMetric["datapoints"]>(
    asArray(body.metrics).map((metric) => {
      const item = asRecord(metric);
      const metricName = asString(item.metric_name);
      const namespace = asString(item.namespace);
      const dimensions = asArray(item.dimensions).map((dimension) => {
        const record = asRecord(dimension);
        return `${asString(record.name)}:${asString(record.value)}`;
      });
      const datapoints = asArray(item.datapoints)
        .map((point) => {
          const datapoint = asRecord(point);
          const value = Number(
            datapoint.average ??
              datapoint.sum ??
              datapoint.max ??
              datapoint.min ??
              datapoint.value,
          );
          const timestamp = Number(datapoint.timestamp);

          if (!Number.isFinite(value) || !Number.isFinite(timestamp)) {
            return null;
          }

          return {
            timestamp: new Date(timestamp).toISOString(),
            value,
          };
        })
        .filter(
          (point): point is { timestamp: string; value: number } =>
            point !== null,
        )
        .sort(
          (left, right) =>
            new Date(left.timestamp).getTime() -
            new Date(right.timestamp).getTime(),
        );

      const candidate = candidates.find(
        (item) =>
          item.namespace === namespace &&
          item.metricName === metricName &&
          item.dimensions
            .map((dimension) => `${dimension.name}:${dimension.value}`)
            .join(",") === dimensions.join(","),
      );

      return [
        candidate
          ? functionGraphMetricKey(candidate)
          : `${namespace}:${metricName}`,
        datapoints,
      ] as const;
    }),
  );
}

async function getFunctionGraphCesMetrics(
  session: HuaweiProjectSession,
  candidates: FunctionGraphMetricCandidate[],
  timeframe: string,
) {
  const metricsByKey = new Map<
    string,
    FunctionGraphMonitoringMetric["datapoints"]
  >();
  const statisticGroups = new Map<
    FunctionGraphMetricCandidate["statistic"],
    FunctionGraphMetricCandidate[]
  >();

  for (const candidate of candidates) {
    const group = statisticGroups.get(candidate.statistic) ?? [];
    group.push(candidate);
    statisticGroups.set(candidate.statistic, group);
  }

  for (const group of statisticGroups.values()) {
    const metrics = await getFunctionGraphCesMetricBatch(
      session,
      group,
      timeframe,
    );

    for (const [key, datapoints] of metrics) {
      metricsByKey.set(key, datapoints);
    }
  }

  return metricsByKey;
}

function functionLookupMatches(fn: FunctionGraphFunction, id: string) {
  let decodedId = id;

  for (let index = 0; index < 3; index += 1) {
    try {
      const next = decodeURIComponent(decodedId);

      if (next === decodedId) {
        break;
      }

      decodedId = next;
    } catch {
      break;
    }
  }

  const candidates = new Set([
    id,
    decodedId,
    baseFunctionGraphUrn(id),
    baseFunctionGraphUrn(decodedId),
  ]);

  return (
    candidates.has(fn.id) || candidates.has(fn.urn) || candidates.has(fn.name)
  );
}

export async function getFunctionGraphFunctionForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const functions = await listFunctionGraphFunctionsForProject(session);
  const summary = functions.find((fn) => functionLookupMatches(fn, id));

  if (!summary) {
    return null;
  }

  const functionUrn = encodeURI(summary.urn || summary.id);
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
  const codeFuncCode = asRecord(code.func_code ?? code.code);
  const merged = {
    ...summary,
    ...config,
    code_filename: firstString(
      [code.code_filename, code.filename, codeFuncCode.code_filename],
      summary.codeFile,
    ),
    code_payload: firstString(
      [
        code.file,
        code.code_package,
        code.code_body,
        codeFuncCode.file,
        codeFuncCode.code_package,
        codeFuncCode.code_body,
      ],
      summary.codePayload,
    ),
    code_size: code.code_size ?? codeFuncCode.code_size ?? summary.codeSize,
    code_text: firstString(
      [
        code.code_text,
        code.source_code,
        codeFuncCode.code,
        codeFuncCode.source_code,
      ],
      summary.codeText,
    ),
    code_type: firstString(
      [code.code_type, code.type, codeFuncCode.type],
      summary.codeType,
    ),
    code_url: firstString(
      [
        code.code_url,
        code.link,
        code.location,
        codeFuncCode.link,
        codeFuncCode.location,
      ],
      summary.codeLink,
    ),
    func_code: codeFuncCode,
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

export async function listFunctionGraphProjectOptions(
  session: BetterUiSession,
) {
  return sessionProjects(session).map((project) => ({
    label: `${project.projectName || project.projectId} · ${project.region}`,
    value: project.projectId,
  }));
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
    results.map((result) => settledValue(result, null)).find(Boolean) ?? null,
  );
}

function parseFunctionGraphCode(
  code: Record<string, unknown>,
  fn: FunctionGraphFunction,
): FunctionGraphCode {
  const funcCode = asRecord(code.funcCode ?? code.func_code ?? code.code);

  return {
    codeFile: firstString(
      [
        code.code_filename,
        code.filename,
        funcCode.code_filename,
        funcCode.filename,
      ],
      fn.codeFile,
    ),
    codeLink: firstString(
      [
        code.code_url,
        code.link,
        code.location,
        funcCode.link,
        funcCode.location,
      ],
      fn.codeLink,
    ),
    codePayload: firstString(
      [
        code.file,
        code.code_package,
        code.code_body,
        funcCode.file,
        funcCode.code_package,
        funcCode.code_body,
      ],
      fn.codePayload,
    ),
    codeSize: numberWithUnit(
      code.codeSize ?? code.code_size ?? funcCode.code_size,
      "bytes",
    ),
    codeText: firstString(
      [code.code_text, code.source_code, funcCode.code, funcCode.source_code],
      fn.codeText,
    ),
    codeType: firstString(
      [code.codeType, code.code_type, code.type, funcCode.type],
      fn.codeType,
    ),
    functionName: firstString([code.funcName, code.func_name], fn.name),
    runtime: firstString([code.runtime], fn.runtime),
    urn: firstString([code.funcUrn, code.func_urn], fn.urn || fn.id),
  };
}

function parseFunctionGraphDependency(
  dependency: Record<string, unknown>,
  session: HuaweiProjectSession,
): FunctionGraphDependencyInventoryItem {
  const lastModified = dependency.last_modified ?? dependency.lastModified;
  const updatedAt =
    typeof lastModified === "number"
      ? new Date(lastModified).toISOString()
      : firstString([lastModified], "");

  return {
    description: firstString([dependency.description], ""),
    etag: firstString([dependency.etag], ""),
    id: firstString(
      [dependency.id, dependency.depend_id, dependency.dependency_id],
      "",
    ),
    isShared: Boolean(dependency.is_shared ?? dependency.isShared),
    link: firstString([dependency.link, dependency.url], ""),
    name: firstString([dependency.name]),
    owner: firstString([dependency.owner, dependency.dependency_type], "-"),
    projectId: session.projectId,
    projectName: session.projectName,
    region: session.region,
    runtime: firstString([dependency.runtime], "-"),
    size: numberWithUnit(dependency.size, "bytes"),
    updatedAt,
    version: firstString([String(dependency.version ?? "")], "-"),
  };
}

export async function listFunctionGraphDependenciesForProject(
  session: HuaweiProjectSession,
) {
  const body = await huaweiList<Record<string, unknown>>(
    session,
    "fg",
    `/v2/${session.projectId}/fgs/dependencies?dependency_type=all&limit=500`,
    {
      items: ["dependencies"],
      kind: "marker",
      parameter: "marker",
      size: 500,
      next: ["next_marker", "nextMarker"],
    },
  );
  return asArray(body.dependencies).map((item) =>
    parseFunctionGraphDependency(asRecord(item), session),
  );
}

async function getFunctionGraphCodeForFunction(
  session: BetterUiSession,
  fn: FunctionGraphFunction,
) {
  const project = projectForFunction(session, fn);
  const urn = encodeURI(fn.urn || fn.id);
  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/functions/${urn}/code`,
    {
      headers: {
        "Content-Type": "application/json",
      },
      method: "GET",
    },
  );
  const code = parseFunctionGraphCode(asRecord(body), fn);

  if (!code.codePayload && code.codeLink) {
    return {
      ...code,
      codePayload: await downloadFunctionGraphCodeLink(session, code.codeLink),
    };
  }

  return code;
}

export async function listFunctionGraphDependencyInventory(
  session: BetterUiSession,
) {
  const dependencies = await loadAcrossProjects(
    session,
    listFunctionGraphDependenciesForProject,
  );

  return dependencies.sort((left, right) => {
    const leftPrivate = left.owner === "public" ? 1 : 0;
    const rightPrivate = right.owner === "public" ? 1 : 0;

    return (
      leftPrivate - rightPrivate ||
      left.name.localeCompare(right.name) ||
      left.runtime.localeCompare(right.runtime)
    );
  });
}

export async function addFunctionGraphFunctionDependency(
  session: BetterUiSession,
  id: string,
  input: AddFunctionGraphDependencyInput,
) {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    throw new Error("FunctionGraph function was not found.");
  }

  if (input.projectId && input.projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  const dependencyName = input.dependencyName.trim();
  if (!dependencyName) {
    throw new Error("Dependency name is required.");
  }

  const manifestType = input.manifestType ?? defaultManifestType(fn);
  const code = await getFunctionGraphCodeForFunction(session, fn);
  const existingPayload = code.codePayload || fn.codePayload;
  const codeFile = code.codeFile || fn.codeFile || "";
  const textPayload =
    code.codeText ||
    (existingPayload && !isZipPayload(existingPayload)
      ? Buffer.from(existingPayload, "base64").toString("utf8")
      : "");

  if (code.codeType.toLowerCase() === "zip" || isZipPayload(existingPayload)) {
    const packageFiles = readZipPackage(existingPayload).map((file) => ({
      ...file,
      content: Buffer.from(file.content),
    }));

    if (packageFiles.length) {
      const manifestName =
        packageFiles.find((file) => file.name.endsWith(manifestType))?.name ??
        manifestType;
      const manifestIndex = packageFiles.findIndex(
        (file) => file.name === manifestName,
      );
      const currentContent =
        manifestIndex >= 0
          ? (packageFiles[manifestIndex]?.content.toString("utf8") ?? "")
          : "";
      const nextManifest = Buffer.from(
        updateDependencyManifestContent(
          currentContent,
          manifestType,
          dependencyName,
          input.version ?? "",
        ),
        "utf8",
      );
      const nextFiles =
        manifestIndex >= 0
          ? packageFiles.map((file, index) =>
              index === manifestIndex
                ? { ...file, content: nextManifest }
                : file,
            )
          : [...packageFiles, { content: nextManifest, name: manifestName }];

      return updateFunctionGraphFunctionCode(
        session,
        fn.id || fn.urn || fn.name,
        {
          codeFilename: "function-code.zip",
          codePayload: buildZipPayload(nextFiles),
          codeType: "zip",
          projectId: fn.projectId,
        },
      );
    }
  }

  if (!textPayload)
    throw new Error(
      "Function source could not be loaded; the dependency update was not submitted.",
    );

  if (codeFile.endsWith(manifestType)) {
    return updateFunctionGraphFunctionCode(
      session,
      fn.id || fn.urn || fn.name,
      {
        codeFilename: codeFile,
        codePayload: Buffer.from(
          updateDependencyManifestContent(
            textPayload,
            manifestType,
            dependencyName,
            input.version ?? "",
          ),
          "utf8",
        ).toString("base64"),
        codeType: "inline",
        projectId: fn.projectId,
      },
    );
  }

  const sourceName = codeFile || `${fn.name || "handler"}.txt`;
  const sourceContent = textPayload
    ? Buffer.from(textPayload, "utf8")
    : Buffer.from("");
  const manifestContent = Buffer.from(
    updateDependencyManifestContent(
      "",
      manifestType,
      dependencyName,
      input.version ?? "",
    ),
    "utf8",
  );

  return updateFunctionGraphFunctionCode(session, fn.id || fn.urn || fn.name, {
    codeFilename: "function-code.zip",
    codePayload: buildZipPayload([
      { content: sourceContent, name: sourceName },
      { content: manifestContent, name: manifestType },
    ]),
    codeType: "zip",
    projectId: fn.projectId,
  });
}

export async function getFunctionGraphFunctionCode(
  session: BetterUiSession,
  id: string,
  projectId?: string,
): Promise<FunctionGraphCode> {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    throw new Error("FunctionGraph function was not found.");
  }

  if (projectId && projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  const project = projectForFunction(session, fn);
  const urn = encodeURI(fn.urn || fn.id);
  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/functions/${urn}/code`,
    {
      headers: {
        "Content-Type": "application/json",
      },
      method: "GET",
    },
  );

  const code = parseFunctionGraphCode(asRecord(body), fn);

  if (!code.codePayload && code.codeLink) {
    return {
      ...code,
      codePayload: await downloadFunctionGraphCodeLink(session, code.codeLink),
    };
  }

  return code;
}

export async function updateFunctionGraphFunctionCode(
  session: BetterUiSession,
  id: string,
  input: UpdateFunctionGraphCodeInput,
) {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    throw new Error("FunctionGraph function was not found.");
  }

  if (input.projectId && input.projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  if (!input.codePayload.trim()) {
    throw new Error("Function code payload is required.");
  }

  const project = projectForFunction(session, fn);
  const urn = encodeURI(fn.urn || fn.id);
  const payload = {
    code_filename:
      input.codeFilename || fn.codeFile || `${fn.name || "function"}.zip`,
    code_type: input.codeType ?? "zip",
    func_code: {
      file: input.codePayload,
      link: "",
    },
  };
  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/functions/${urn}/code`,
    {
      body: JSON.stringify(payload),
      method: "PUT",
    },
  );

  return parseFunctionGraphCode(asRecord(body), fn);
}

function numberFromUnit(value: string, fallback: number) {
  const match = value.match(/\d+/);

  if (!match) {
    return fallback;
  }

  const parsed = Number(match[0]);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function blankToUndefined(value: string | undefined) {
  if (value === undefined) {
    return undefined;
  }

  const trimmed = value.trim();
  return trimmed && trimmed !== "-" ? trimmed : undefined;
}

function setIfPresent(
  payload: Record<string, unknown>,
  key: string,
  value: unknown,
) {
  if (value === undefined || value === null) {
    return;
  }

  payload[key] = value;
}

export async function updateFunctionGraphFunctionConfig(
  session: BetterUiSession,
  id: string,
  input: UpdateFunctionGraphConfigInput,
) {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    throw new Error("FunctionGraph function was not found.");
  }

  if (input.projectId && input.projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  const project = projectForFunction(session, fn);
  const urn = encodeURI(fn.urn || fn.id);
  const strategyConfig =
    input.strategyConfig && typeof input.strategyConfig === "object"
      ? { ...asRecord(input.strategyConfig) }
      : {};

  if (input.strategyConcurrency !== undefined) {
    strategyConfig.concurrency = input.strategyConcurrency;
  }

  const payload: Record<string, unknown> = {
    func_name: blankToUndefined(input.name) ?? fn.name,
    handler: blankToUndefined(input.handler) ?? fn.handler,
    memory_size: input.memorySize ?? numberFromUnit(fn.memorySize, 128),
    runtime: blankToUndefined(input.runtime) ?? fn.runtime,
    timeout: input.timeout ?? numberFromUnit(fn.timeout, 3),
  };

  setIfPresent(payload, "app_xrole", blankToUndefined(input.appXrole));
  setIfPresent(payload, "custom_image", input.customImageConfig);
  setIfPresent(payload, "description", input.description ?? fn.description);
  setIfPresent(payload, "domain_names", input.domainNamesConfig);
  setIfPresent(payload, "enable_auth_in_header", input.enableAuthInHeader);
  setIfPresent(payload, "enable_lts_log", input.enableLtsLog);
  setIfPresent(
    payload,
    "encrypted_user_data",
    blankToUndefined(input.encryptedUserData),
  );
  setIfPresent(
    payload,
    "enterprise_project_id",
    blankToUndefined(input.enterpriseProjectId),
  );
  setIfPresent(payload, "ephemeral_storage", input.ephemeralStorage);
  setIfPresent(payload, "extend_config", input.extendConfig);
  setIfPresent(payload, "func_vpc", input.funcVpcConfig);
  setIfPresent(
    payload,
    "initializer_handler",
    blankToUndefined(input.initializerHandler),
  );
  setIfPresent(payload, "initializer_timeout", input.initializerTimeout);
  setIfPresent(payload, "log_config", input.logConfig);
  setIfPresent(payload, "mount_config", input.mountConfig);
  setIfPresent(payload, "network_controller", input.networkController);
  setIfPresent(
    payload,
    "strategy_config",
    Object.keys(strategyConfig).length ? strategyConfig : undefined,
  );
  setIfPresent(payload, "user_data", input.userData ?? "");
  setIfPresent(payload, "xrole", blankToUndefined(input.xrole));

  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/functions/${urn}/config`,
    {
      body: JSON.stringify(payload),
      method: "PUT",
    },
  );

  return parseFunctionGraphFunction(asRecord(body), project);
}

function normalizeTriggerList(body: unknown) {
  if (Array.isArray(body)) {
    return body;
  }

  const record = asRecord(body);
  return asArray(record.triggers ?? record.body);
}

async function getTriggerFunctionAndProject(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    throw new Error("FunctionGraph function was not found.");
  }

  if (projectId && projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  return {
    fn,
    project: projectForFunction(session, fn),
    urn: encodeURI(fn.urn || fn.id),
  };
}

export async function listFunctionGraphTriggers(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  const { project, urn } = await getTriggerFunctionAndProject(
    session,
    id,
    projectId,
  );
  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/triggers/${urn}`,
    { method: "GET" },
  );

  return normalizeTriggerList(body).map((trigger) =>
    parseFunctionGraphTrigger(asRecord(trigger)),
  );
}

async function listFunctionGraphTriggersForFunction(
  session: BetterUiSession,
  fn: FunctionGraphFunction,
) {
  const project = projectForFunction(session, fn);
  const urn = encodeURI(fn.urn || fn.id);
  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/triggers/${urn}`,
    { method: "GET" },
  );

  return normalizeTriggerList(body).map(
    (trigger): FunctionGraphTriggerInventoryItem => ({
      ...parseFunctionGraphTrigger(asRecord(trigger)),
      functionId: fn.id || fn.urn || fn.name,
      functionName: fn.name,
      functionPackage: fn.packageName,
      functionRuntime: fn.runtime,
      functionUrn: fn.urn || fn.id,
      projectId: fn.projectId,
      projectName: fn.projectName,
      region: fn.region,
    }),
  );
}

export async function listFunctionGraphTriggerInventory(
  session: BetterUiSession,
) {
  const functions = await listFunctionGraphFunctions(session);
  const results = await Promise.allSettled(
    functions.map((fn) => listFunctionGraphTriggersForFunction(session, fn)),
  );

  return finishCloudLoad(
    results,
    results.flatMap((result) => settledValue(result, [])),
    functions.map((fn) => `${fn.name} triggers`),
  );
}

async function getFunctionGraphCost(
  session: BetterUiSession,
  fn: FunctionGraphFunction,
) {
  const candidates = Array.from(
    new Set([fn.resourceId, fn.id, fn.urn].filter(Boolean)),
  ).filter((resourceId) => resourceId.length <= 64);

  for (const resourceId of candidates) {
    const cost = await getMonthlyResourceCost(session, resourceId, {
      cloudServiceType: "hws.service.type.functionstage",
      region: fn.region,
    }).catch(() => null);

    if (
      cost &&
      (cost.recordCount > 0 ||
        cost.amount > 0 ||
        resourceId === candidates.at(-1))
    ) {
      return cost;
    }
  }

  return null;
}

export async function getFunctionGraphMonitoring(
  session: BetterUiSession,
  id: string,
  timeframe = "6h",
): Promise<FunctionGraphMonitoring | null> {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    return null;
  }

  const project = projectForFunction(session, fn);
  const dimensions = functionGraphMetricDimensions(fn);
  const metricDefinitions: Array<{
    label: string;
    metricName: string;
    statistic: "average" | "max" | "min" | "sum";
    unit: string;
  }> = [
    {
      label: "Invocations",
      metricName: "count",
      statistic: "sum",
      unit: "Count",
    },
    {
      label: "Average duration",
      metricName: "duration",
      statistic: "average",
      unit: "ms",
    },
    {
      label: "Max duration",
      metricName: "maxDuration",
      statistic: "max",
      unit: "ms",
    },
    {
      label: "Min duration",
      metricName: "minDuration",
      statistic: "min",
      unit: "ms",
    },
    {
      label: "Errors",
      metricName: "failcount",
      statistic: "sum",
      unit: "Count",
    },
    {
      label: "Error rate",
      metricName: "failRate",
      statistic: "average",
      unit: "%",
    },
    {
      label: "Throttles",
      metricName: "rejectcount",
      statistic: "sum",
      unit: "Count",
    },
    {
      label: "Concurrent executions",
      metricName: "concurrency",
      statistic: "max",
      unit: "Count",
    },
    {
      label: "Elastic instances",
      metricName: "payPerUseInstance",
      statistic: "max",
      unit: "Count",
    },
    {
      label: "Memory used",
      metricName: "memoryUsed",
      statistic: "max",
      unit: "MB",
    },
    {
      label: "Resource usage",
      metricName: "functionCost",
      statistic: "sum",
      unit: "MB",
    },
  ];
  const staticCandidates = metricDefinitions.flatMap((metric) =>
    dimensions.map((dimension) => ({
      dimensions: [dimension],
      metricName: metric.metricName,
      namespace: "SYS.FunctionGraph",
      statistic: metric.statistic,
      unit: metric.unit,
    })),
  );
  const discoveredCandidates = await listFunctionGraphCesMetricCandidates(
    project,
    fn,
    metricDefinitions,
  ).catch(() => []);
  const discoveredMetricNames = new Set(
    discoveredCandidates.map((candidate) => candidate.metricName),
  );
  const candidates = [
    ...discoveredCandidates,
    ...staticCandidates.filter(
      (candidate) => !discoveredMetricNames.has(candidate.metricName),
    ),
  ].filter((candidate, index, all) => {
    const key = functionGraphMetricKey(candidate);
    return (
      all.findIndex((item) => functionGraphMetricKey(item) === key) === index
    );
  });
  const datapointsByMetric = await getFunctionGraphCesMetrics(
    project,
    candidates,
    timeframe,
  );
  const metrics = metricDefinitions.map((definition) => {
    const metricCandidates = candidates.filter(
      (candidate) => candidate.metricName === definition.metricName,
    );
    const selectedCandidate =
      metricCandidates.find(
        (candidate) =>
          (datapointsByMetric.get(functionGraphMetricKey(candidate)) ?? [])
            .length > 0,
      ) ?? metricCandidates[0];
    const datapoints = selectedCandidate
      ? (datapointsByMetric.get(functionGraphMetricKey(selectedCandidate)) ??
        [])
      : [];

    return {
      datapoints,
      label: definition.label,
      metricName: definition.metricName,
      namespace: "SYS.FunctionGraph",
      statistic: definition.statistic,
      total:
        definition.statistic === "max"
          ? Math.max(...datapoints.map((point) => point.value), 0)
          : definition.statistic === "min"
            ? datapoints.length
              ? Math.min(...datapoints.map((point) => point.value))
              : 0
            : definition.statistic === "average"
              ? datapoints.reduce((sum, point) => sum + point.value, 0) /
                Math.max(datapoints.length, 1)
              : datapoints.reduce((sum, point) => sum + point.value, 0),
      unit: definition.unit,
    };
  });

  return {
    cost: await getFunctionGraphCost(session, fn),
    metrics,
    projectId: fn.projectId,
    region: fn.region,
    timeframe: monitoringWindow(timeframe).timeframe,
  };
}

export async function getFunctionGraphLogs(
  session: BetterUiSession,
  id: string,
  options: {
    endTime?: number;
    keywords?: string;
    limit?: number;
    projectId?: string;
    startTime?: number;
  } = {},
): Promise<FunctionGraphLogs | null> {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    return null;
  }

  if (options.projectId && options.projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  const project = projectForFunction(session, fn);
  const config = parseLogConfig(fn.logConfig);
  const groupId = firstString([config.group_id, config.groupId], "");
  const streamId = firstString([config.stream_id, config.streamId], "");

  if (!groupId || !streamId) {
    return {
      count: 0,
      entries: [],
      groupId,
      groupName: firstString([config.group_name, config.groupName], "-"),
      projectId: fn.projectId,
      region: fn.region,
      streamId,
      streamName: firstString([config.stream_name, config.streamName], "-"),
    };
  }

  const now = Date.now();
  const body = await huaweiFetch<{
    count?: unknown;
    logs?: unknown[];
  }>(
    project,
    "lts",
    `/v2/${project.projectId}/groups/${encodeURIComponent(groupId)}/streams/${encodeURIComponent(streamId)}/content/query`,
    {
      body: JSON.stringify({
        end_time: String(options.endTime ?? now),
        is_count: true,
        is_desc: true,
        keywords: options.keywords || undefined,
        limit: Math.min(Math.max(options.limit ?? 50, 1), 100),
        start_time: String(options.startTime ?? now - 60 * 60 * 1000),
      }),
      method: "POST",
    },
  );

  return {
    count: Number(body.count ?? 0),
    entries: asArray(body.logs).map((log) => {
      const item = asRecord(log);
      const labels = asRecord(item.labels);

      return {
        content: asString(item.content, ""),
        labels: Object.fromEntries(
          Object.entries(labels).map(([key, value]) => [
            key,
            asString(value, ""),
          ]),
        ),
        lineNumber: firstString([item.line_num, item.lineNum], ""),
      };
    }),
    groupId,
    groupName: firstString([config.group_name, config.groupName], "-"),
    projectId: fn.projectId,
    region: fn.region,
    streamId,
    streamName: firstString([config.stream_name, config.streamName], "-"),
  };
}

export async function createFunctionGraphTrigger(
  session: BetterUiSession,
  id: string,
  input: FunctionGraphTriggerInput,
) {
  const { project, urn } = await getTriggerFunctionAndProject(
    session,
    id,
    input.projectId,
  );
  const payload: Record<string, unknown> = {
    event_data: input.eventData ?? {},
    trigger_status: input.triggerStatus || "ACTIVE",
    trigger_type_code: input.triggerTypeCode,
  };

  if (input.eventTypeCode) {
    payload.event_type_code = input.eventTypeCode;
  }

  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/triggers/${urn}`,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );

  return parseFunctionGraphTrigger(asRecord(body));
}

export async function updateFunctionGraphTrigger(
  session: BetterUiSession,
  id: string,
  triggerId: string,
  input: UpdateFunctionGraphTriggerInput,
) {
  const { project, urn } = await getTriggerFunctionAndProject(
    session,
    id,
    input.projectId,
  );
  const payload: Record<string, unknown> = {};

  if (input.triggerStatus) {
    payload.trigger_status = input.triggerStatus;
  }

  if (input.eventData !== undefined) {
    payload.event_data = input.eventData;
  }

  const { body } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/triggers/${urn}/${encodeURIComponent(input.triggerTypeCode)}/${encodeURIComponent(triggerId)}`,
    {
      body: JSON.stringify(payload),
      method: "PUT",
    },
  );

  return parseFunctionGraphTrigger(asRecord(body));
}

export async function deleteFunctionGraphTrigger(
  session: BetterUiSession,
  id: string,
  triggerId: string,
  triggerTypeCode: string,
  projectId?: string,
) {
  const { project, urn } = await getTriggerFunctionAndProject(
    session,
    id,
    projectId,
  );

  await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/triggers/${urn}/${encodeURIComponent(triggerTypeCode)}/${encodeURIComponent(triggerId)}`,
    { method: "DELETE" },
  );
}

function projectForFunction(
  session: BetterUiSession,
  fn: FunctionGraphFunction,
) {
  return projectForId(session, fn.projectId);
}

export async function createFunctionGraphFunction(
  session: BetterUiSession,
  input: CreateFunctionGraphFunctionInput,
) {
  const project = projectForId(session, input.projectId);
  const payload = {
    code_type: "inline",
    description: input.description ?? "",
    func_code: {
      file: Buffer.from(input.code, "utf8").toString("base64"),
      link: "",
    },
    func_name: input.name,
    handler: input.handler,
    memory_size: input.memorySize,
    package: input.packageName,
    runtime: input.runtime,
    timeout: input.timeout,
    type: "v2",
  };
  const body = await huaweiFetch<Record<string, unknown>>(
    project,
    "fg",
    `/v2/${project.projectId}/fgs/functions`,
    {
      body: JSON.stringify(payload),
      method: "POST",
    },
  );

  return parseFunctionGraphFunction(body, project);
}

export async function invokeFunctionGraphFunction(
  session: BetterUiSession,
  id: string,
  input: InvokeFunctionGraphFunctionInput,
): Promise<FunctionGraphInvokeResult> {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    throw new Error("FunctionGraph function was not found.");
  }

  if (input.projectId && input.projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  const project = projectForFunction(session, fn);
  const urn = encodeURIComponent(fn.urn || fn.id);
  const { body, response } = await functionGraphFetchWithHeaders(
    project,
    `/v2/${project.projectId}/fgs/functions/${urn}/invocations`,
    {
      body: JSON.stringify(input.event ?? {}),
      headers:
        input.logType === "tail" ? { "X-Cff-Log-Type": "tail" } : undefined,
      method: "POST",
    },
  );

  return {
    body,
    functionLog: response.headers.get("X-Cff-Function-Log") ?? "",
    requestId: response.headers.get("X-Request-Id") ?? "",
    status: response.status,
    summary: response.headers.get("X-Cff-Invoke-Summary") ?? "",
  };
}

function wholeFunctionUrn(fn: FunctionGraphFunction) {
  const urn = fn.urn || fn.id;

  if (
    fn.version.toLowerCase() === "latest" &&
    urn.toLowerCase().endsWith(":latest")
  ) {
    return urn.slice(0, -":latest".length);
  }

  return urn;
}

export async function deleteFunctionGraphFunction(
  session: BetterUiSession,
  id: string,
  projectId?: string,
) {
  const fn = await getFunctionGraphFunction(session, id);

  if (!fn) {
    throw new Error("FunctionGraph function was not found.");
  }

  if (projectId && projectId !== fn.projectId) {
    throw new Error(
      "Project id does not match the target FunctionGraph function.",
    );
  }

  const project = projectForFunction(session, fn);
  const urn = encodeURIComponent(wholeFunctionUrn(fn));

  await huaweiFetch<Record<string, unknown>>(
    project,
    "fg",
    `/v2/${project.projectId}/fgs/functions/${urn}`,
    { method: "DELETE" },
  );

  return fn;
}

export type * from "@/lib/huawei/services/functiongraph.types";
