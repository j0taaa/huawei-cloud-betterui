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
import type { ManagementAdapter } from "./types";

export const managementAdapters: Record<string, ManagementAdapter> = {
  "enterprise-projects": enterpriseProjectsManagement,
  aom: aomManagement,
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
