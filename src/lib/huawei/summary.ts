import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import "server-only";

import { finishCloudLoad, settledValue } from "@/lib/huawei/errors";

import { normalizeError } from "@/lib/huawei/parsers";
import { withCloudResult } from "@/lib/huawei/result";
import { listCceClusters } from "@/lib/huawei/services/cce";
import { listEcsInstances } from "@/lib/huawei/services/ecs";
import { listElbs } from "@/lib/huawei/services/elb";
import { listEvsDisks } from "@/lib/huawei/services/evs";
import { listRdsInstances } from "@/lib/huawei/services/rds";
import {
  listSecurityGroups,
  listSubnets,
  listVpcs,
} from "@/lib/huawei/services/vpc";

export type CloudSummary = {
  cceClusters: number;
  ecsInstances: number;
  ecsRunning: number;
  elbLoadBalancers: number;
  errors: string[];
  evsDisks: number;
  rdsInstances: number;
  securityGroups: number;
  subnets: number;
  vpcs: number;
};

export const emptySummary: CloudSummary = {
  cceClusters: 0,
  ecsInstances: 0,
  ecsRunning: 0,
  elbLoadBalancers: 0,
  errors: [],
  evsDisks: 0,
  rdsInstances: 0,
  securityGroups: 0,
  subnets: 0,
  vpcs: 0,
};

export async function loadCloudSummary() {
  return withCloudResult(
    emptySummary,
    async (session) => {
      const [ecs, evs, vpcs, subnets, securityGroups, elbs, cce, rds] =
        await Promise.allSettled([
          listEcsInstances(session),
          listEvsDisks(session),
          listVpcs(session),
          listSubnets(session),
          listSecurityGroups(session),
          listElbs(session),
          listCceClusters(session),
          listRdsInstances(session),
        ]);

      const errors = [ecs, evs, vpcs, subnets, securityGroups, elbs, cce, rds]
        .filter(
          (result): result is PromiseRejectedResult =>
            result.status === "rejected",
        )
        .map((result) => normalizeError(result.reason));

      const ecsData = settledValue(ecs, []);

      return finishCloudLoad(
        [ecs, evs, vpcs, subnets, securityGroups, elbs, cce, rds],
        {
          cceClusters: settledValue(cce, []).length,
          ecsInstances: ecsData.length,
          ecsRunning: ecsData.filter((instance) => instance.status === "ACTIVE")
            .length,
          elbLoadBalancers: settledValue(elbs, []).length,
          errors,
          evsDisks: settledValue(evs, []).length,
          rdsInstances: settledValue(rds, []).length,
          securityGroups: settledValue(securityGroups, []).length,
          subnets: settledValue(subnets, []).length,
          vpcs: settledValue(vpcs, []).length,
        },
      );
    },
    cloudCacheKeys.summary,
  );
}
