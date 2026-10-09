export type EcsInstance = {
  addresses: Array<{
    ip: string;
    macAddress: string;
    network: string;
    type: "private" | "public" | "unknown";
    version: string;
  }>;
  attachedDiskIds: string[];
  availabilityZone: string;
  chargingMode: string;
  createdAt: string;
  description: string;
  enterpriseProjectId: string;
  flavor: string;
  flavorId: string;
  id: string;
  image: string;
  imageId: string;
  imageName: string;
  keyName: string;
  launchedAt: string;
  metadata: Array<{
    key: string;
    value: string;
  }>;
  name: string;
  osType: string;
  powerState: string;
  privateIp: string;
  publicIp: string;
  securityGroups: Array<{
    id: string;
    name: string;
  }>;
  status: string;
  systemDisk: {
    id: string;
    name: string;
    size: string;
    status: string;
    type: string;
  } | null;
  tags: Array<{
    key: string;
    value: string;
  }>;
  taskState: string;
  updatedAt: string;
  vmState: string;
  projectId: string;
  projectName: string;
  region: string;
};

export type EcsMonitoringMetric = {
  datapoints: Array<{
    timestamp: string;
    value: number;
  }>;
  label: string;
  metricName: string;
  namespace: string;
  unit: string;
};

export type EcsMonitoring = {
  metrics: EcsMonitoringMetric[];
  projectId: string;
  region: string;
};
