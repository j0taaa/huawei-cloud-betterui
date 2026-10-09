export type FunctionGraphCode = {
  codeFile: string;
  codeLink: string;
  codePayload: string;
  codeSize: string;
  codeText: string;
  codeType: string;
  functionName: string;
  runtime: string;
  urn: string;
};

export type FunctionGraphDependencyInventoryItem = {
  description: string;
  etag: string;
  id: string;
  isShared: boolean;
  link: string;
  name: string;
  owner: string;
  projectId: string;
  projectName: string;
  region: string;
  runtime: string;
  size: string;
  updatedAt: string;
  version: string;
};

export type FunctionGraphFunction = {
  appXrole: string;
  codeFile: string;
  codeLink: string;
  codePayload: string;
  codeSize: string;
  codeText: string;
  codeType: string;
  cpu: string;
  description: string;
  digest: string;
  domainNamesConfig: string;
  enableAuthInHeader: string;
  enableLtsLog: string;
  encryptedUserData: string;
  enterpriseProjectId: string;
  ephemeralStorage: string;
  extendConfig: string;
  funcVpcConfig: string;
  handler: string;
  id: string;
  initializerHandler: string;
  initializerTimeout: string;
  logConfig: string;
  lastModified: string;
  memorySize: string;
  mountConfig: string;
  name: string;
  networkController: string;
  packageName: string;
  projectId: string;
  projectName: string;
  region: string;
  reservedInstances: string;
  resourceId: string;
  runtime: string;
  serviceUrn: string;
  customImageConfig: string;
  strategyConfig: string;
  strategyConcurrency: string;
  timeout: string;
  urn: string;
  userData: string;
  version: string;
  vpcId: string;
  xrole: string;
};

export type FunctionGraphLogs = {
  count: number;
  entries: FunctionGraphLogEntry[];
  groupId: string;
  groupName: string;
  projectId: string;
  region: string;
  streamId: string;
  streamName: string;
};

export type FunctionGraphInvokeResult = {
  body: unknown;
  functionLog: string;
  requestId: string;
  status: number;
  summary: string;
};

export type FunctionGraphMonitoring = {
  cost: {
    amount: number;
    billingCycle: string;
    currency: string;
    recordCount: number;
    resourceId: string;
  } | null;
  metrics: FunctionGraphMonitoringMetric[];
  projectId: string;
  region: string;
  timeframe: string;
};

export type FunctionGraphMonitoringMetric = {
  datapoints: Array<{
    timestamp: string;
    value: number;
  }>;
  label: string;
  metricName: string;
  namespace: string;
  statistic: "average" | "max" | "min" | "sum";
  total: number;
  unit: string;
};

export type FunctionGraphTrigger = {
  createdAt: string;
  eventData: string;
  eventTypeCode: string;
  id: string;
  name: string;
  status: string;
  triggerTypeCode: string;
  updatedAt: string;
};

export type FunctionGraphTriggerInventoryItem = FunctionGraphTrigger & {
  functionId: string;
  functionName: string;
  functionPackage: string;
  functionRuntime: string;
  functionUrn: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type FunctionGraphLogEntry = {
  content: string;
  labels: Record<string, string>;
  lineNumber: string;
};
