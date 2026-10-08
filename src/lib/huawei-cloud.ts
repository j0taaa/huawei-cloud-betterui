import "server-only";

// Stable public entry point. Implementations live in focused service adapters.
export {
  getAsGroup,
  listAsGroups,
  type AsGroup,
  type AsGroupDetail,
  type AsInstance,
  type AsPolicy,
} from "./huawei/services/as";
export {
  getSwrRepository,
  listSwrRepositories,
  type SwrRepository,
  type SwrRepositoryDetail,
  type SwrTag,
} from "./huawei/services/swr";
export {
  getBillingSummary,
  getCostReport,
  emptyBillingSummary,
  emptyCostReport,
  type BillRow,
  type BillingSummary,
  type CostReport,
  type CostRow,
} from "./huawei/services/billing";
export {
  invalidateCloudResult,
  withCloudResult,
  type CloudResult,
} from "./huawei/result";
export { listApigInstances, type ApigInstance } from "./huawei/services/apig";
export { listBmsServers, type BmsServer } from "./huawei/services/bms";
export { listCbhInstances, type CbhInstance } from "./huawei/services/cbh";
export { listCbrVaults, type CbrVault } from "./huawei/services/cbr";
export {
  getCceCluster,
  listCceClusters,
  type CceCluster,
} from "./huawei/services/cce";
export { listCciNamespaces, type CciNamespace } from "./huawei/services/cci";
export { listCdmClusters, type CdmCluster } from "./huawei/services/cdm";
export { listCdnDomains, type CdnDomain } from "./huawei/services/cdn";
export { listCesAlarmRules, type CesAlarmRule } from "./huawei/services/ces";
export { listCloudFirewalls, type CloudFirewall } from "./huawei/services/cfw";
export {
  listCodeArtsBuildJobs,
  type CodeArtsBuildJob,
} from "./huawei/services/codearts-build";
export {
  listCodeArtsDeployApplications,
  type CodeArtsDeployApplication,
} from "./huawei/services/codearts-deploy";
export {
  listCodeArtsPipelines,
  type CodeArtsPipelineItem,
} from "./huawei/services/codearts-pipeline";
export {
  listCodeArtsRepositories,
  type CodeArtsRepository,
} from "./huawei/services/codearts-repo";
export { listCphServers, type CphServer } from "./huawei/services/cph";
export { listCssClusters, type CssCluster } from "./huawei/services/css";
export {
  listCtsTraces,
  listCtsTrackers,
  type CtsTrace,
  type CtsTracker,
} from "./huawei/services/cts";
export {
  listDataArtsInstances,
  type DataArtsInstance,
} from "./huawei/services/dataarts";
export {
  listDcsRedisInstances,
  type DcsRedisInstance,
} from "./huawei/services/dcs";
export { listDdsInstances, type DdsInstance } from "./huawei/services/dds";
export { listDedicatedHosts, type DedicatedHost } from "./huawei/services/deh";
export { listDewKeys, type DewKey } from "./huawei/services/dew";
export {
  listDirectConnectConnections,
  type DirectConnectConnection,
} from "./huawei/services/direct-connect";
export { listDliQueues, type DliQueue } from "./huawei/services/dli";
export {
  listDmsKafkaInstances,
  type DmsKafkaInstance,
} from "./huawei/services/dms-kafka";
export { listDnsZones, type DnsZone } from "./huawei/services/dns";
export { listDrsJobs, type DrsJob } from "./huawei/services/drs";
export { listDwsClusters, type DwsCluster } from "./huawei/services/dws";
export {
  getEcsInstance,
  getEcsMonitoring,
  getEcsSnapshots,
  listEcsInstances,
  runEcsAction,
  type EcsInstance,
  type EcsMonitoring,
  type EcsMonitoringMetric,
} from "./huawei/services/ecs";
export { listEips, type EipItem } from "./huawei/services/eip";
export { getElb, listElbs, type ElbItem } from "./huawei/services/elb";
export {
  listEnterpriseRouters,
  type EnterpriseRouter,
} from "./huawei/services/enterprise-router";
export {
  listEventGridSubscriptions,
  type EventGridSubscription,
} from "./huawei/services/eventgrid";
export {
  createEvsSnapshot,
  deleteEvsSnapshot,
  getEvsDisk,
  listEvsDisks,
  listEvsSnapshots,
  type EvsDisk,
  type EvsSnapshot,
} from "./huawei/services/evs";
export {
  listFlexusResources,
  type FlexusResource,
} from "./huawei/services/flexus";
export {
  getFunctionGraphFunction,
  listFunctionGraphFunctions,
  type FunctionGraphFunction,
} from "./huawei/services/functiongraph";
export {
  listGaussDbInstances,
  type GaussDbInstance,
} from "./huawei/services/gaussdb";
export {
  listGeminiDbInstances,
  type GeminiDbInstance,
} from "./huawei/services/geminidb";
export { listHssHosts, type HssHost } from "./huawei/services/hss";
export { listIamUsers, type IamUser } from "./huawei/services/iam";
export { listImages, type ImsImage } from "./huawei/services/ims";
export { listIotdaDevices, type IotdaDevice } from "./huawei/services/iotda";
export {
  listKooGalleryPurchasedApis,
  type KooGalleryPurchasedApi,
} from "./huawei/services/koogallery";
export { listLtsLogGroups, type LtsLogGroup } from "./huawei/services/lts";
export {
  listMgcMigrationItems,
  type MgcMigrationItem,
} from "./huawei/services/mgc";
export {
  listModelArtsNotebooks,
  type ModelArtsNotebook,
} from "./huawei/services/modelarts";
export { listMrsClusters, type MrsCluster } from "./huawei/services/mrs";
export { listNatGateways, type NatGateway } from "./huawei/services/nat";
export {
  downloadObsObject,
  getObsBucket,
  getObsObjectDetail,
  listObsBuckets,
  uploadObsObject,
  type ObsBucket,
  type ObsBucketDetail,
  type ObsObject,
  type ObsObjectDetail,
} from "./huawei/services/obs";
export {
  listOmsMigrationTasks,
  type OmsMigrationTask,
} from "./huawei/services/oms";
export {
  getRdsInstance,
  listRdsInstances,
  type RdsInstance,
} from "./huawei/services/rds";
export {
  listSdrsProtectedInstances,
  type SdrsProtectedInstance,
} from "./huawei/services/sdrs";
export {
  listSecMasterWorkspaces,
  type SecMasterWorkspace,
} from "./huawei/services/secmaster";
export {
  listServiceStageApplications,
  type ServiceStageApplication,
} from "./huawei/services/servicestage";
export { listSfsShares, type SfsShare } from "./huawei/services/sfs";
export { listSmnTopics, type SmnTopic } from "./huawei/services/smn";
export { listSmsTasks, type SmsMigrationTask } from "./huawei/services/sms";
export {
  listTaurusDbInstances,
  type TaurusDbInstance,
} from "./huawei/services/taurusdb";
export {
  listSecurityGroups,
  listSubnets,
  listVpcs,
  type SecurityGroupItem,
  type SubnetItem,
  type VpcItem,
} from "./huawei/services/vpc";
export {
  listVpcEndpoints,
  type VpcEndpoint,
} from "./huawei/services/vpc-endpoint";
export { listVpnConnections, type VpnConnection } from "./huawei/services/vpn";
export { listWafInstances, type WafInstance } from "./huawei/services/waf";
export {
  listWorkspaceTenants,
  type WorkspaceTenant,
} from "./huawei/services/workspace";
export { loadCloudSummary, type CloudSummary } from "./huawei/summary";
