import "server-only";
import { enterpriseProjectsManagement } from "./adapters/enterprise-projects";
import { aomManagement } from "./adapters/aom";
import { messagingManagement } from "./adapters/messaging";
import { ecsManagement } from "./adapters/ecs";
import { dewManagement } from "./adapters/dew";
import { cdnManagement } from "./adapters/cdn";
import { cesManagement } from "./adapters/ces";
import { networkManagement } from "./adapters/network";
import { dnsManagement } from "./adapters/dns";
import { smnManagement } from "./adapters/smn";
import { ltsManagement } from "./adapters/lts";
import { ctsManagement } from "./adapters/cts";
import { elbManagement } from "./adapters/elb";
import { eipManagement } from "./adapters/eip";
import { obsManagement } from "./adapters/obs";
import { cbrManagement } from "./adapters/cbr";
import { sfsManagement } from "./adapters/sfs";
import { swrManagement } from "./adapters/swr";
import { asManagement } from "./adapters/as";
import { natManagement } from "./adapters/nat";
import { evsManagement } from "./adapters/evs";
import { iamManagement } from "./adapters/iam";
import { dehManagement } from "./adapters/deh";
import { dcsManagement } from "./adapters/dcs";
import { kafkaManagement } from "./adapters/kafka";
import { iotdaManagement } from "./adapters/iotda";
import { rdsManagement } from "./adapters/rds";
import { imsManagement } from "./adapters/ims";
import { dliManagement } from "./adapters/dli";
import { secmasterManagement } from "./adapters/secmaster";
import { enterpriseRouterManagement } from "./adapters/enterprise-router";
import { vpcEndpointManagement } from "./adapters/vpc-endpoint";
import { eventgridManagement } from "./adapters/eventgrid";
import { apigManagement } from "./adapters/apig";
import { omsManagement } from "./adapters/oms";
import { wafManagement } from "./adapters/waf";
import { cciManagement } from "./adapters/cci";
import { cssManagement } from "./adapters/css";
import { cceManagement } from "./adapters/cce";
import { ddsManagement } from "./adapters/dds";
import { gaussdbManagement } from "./adapters/gaussdb";
import { taurusdbManagement } from "./adapters/taurusdb";
import { geminidbManagement } from "./adapters/geminidb";
import { codeartsPipelineManagement } from "./adapters/codearts-pipeline";
import { codeartsBuildManagement } from "./adapters/codearts-build";
import { codeartsRepoManagement } from "./adapters/codearts-repo";
import { cdmManagement } from "./adapters/cdm";
import { smsManagement } from "./adapters/sms";
import { sdrsManagement } from "./adapters/sdrs";
import type { ManagementAdapter } from "./types";

export const managementAdapters: Record<string, ManagementAdapter> = {
  "enterprise-projects": enterpriseProjectsManagement,
  aom: aomManagement,
  as: asManagement,
  nat: natManagement,
  evs: evsManagement,
  iam: iamManagement,
  deh: dehManagement,
  dcs: dcsManagement,
  "dms-kafka": kafkaManagement,
  iotda: iotdaManagement,
  rds: rdsManagement,
  ims: imsManagement,
  dli: dliManagement,
  secmaster: secmasterManagement,
  "enterprise-router": enterpriseRouterManagement,
  "vpc-endpoint": vpcEndpointManagement,
  eventgrid: eventgridManagement,
  apig: apigManagement,
  oms: omsManagement,
  dds: ddsManagement,
  cce: cceManagement,
  css: cssManagement,
  cci: cciManagement,
  waf: wafManagement,
  gaussdb: gaussdbManagement,
  taurusdb: taurusdbManagement,
  geminidb: geminidbManagement,
  "codearts-repo": codeartsRepoManagement,
  "codearts-build": codeartsBuildManagement,
  "codearts-pipeline": codeartsPipelineManagement,
  sdrs: sdrsManagement,
  cdm: cdmManagement,
  sms: smsManagement,
  ecs: ecsManagement,
  dew: dewManagement,
  cdn: cdnManagement,
  ces: cesManagement,
  cts: ctsManagement,
  eip: eipManagement,
  elb: elbManagement,
  obs: obsManagement,
  cbr: cbrManagement,
  sfs: sfsManagement,
  swr: swrManagement,
  network: networkManagement,
  dns: dnsManagement,
  smn: smnManagement,
  lts: ltsManagement,
  "dms-rabbitmq": messagingManagement("rabbitmq"),
  "dms-rocketmq": messagingManagement("rocketmq"),
};
