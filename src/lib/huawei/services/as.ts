import "server-only";

import type { BetterUiSession, HuaweiProjectSession } from "@/lib/auth-session";
import {
  finishCloudLoad,
  mapCloudLoad,
  settledValue,
} from "@/lib/huawei/errors";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { asArray, asRecord, asString } from "@/lib/huawei/parsers";
import { loadAcrossProjects, projectForId } from "@/lib/huawei/projects";

export type AsGroup = {
  id: string;
  name: string;
  status: string;
  projectId: string;
  projectName: string;
  region: string;
  current: number;
  desired: number;
  minimum: number;
  maximum: number;
  configurationId: string;
  configurationName: string;
  vpcId: string;
  subnetIds: string[];
  availabilityZones: string[];
  healthCheck: string;
  cooldown: number;
  isScaling: boolean;
  createdAt: string;
  description: string;
};

export type AsInstance = {
  id: string;
  name: string;
  lifecycle: string;
  health: string;
  protected: boolean;
  configurationName: string;
  createdAt: string;
};

export type AsPolicy = {
  id: string;
  name: string;
  type: string;
  status: string;
  operation: string;
  instanceNumber: number | null;
  instancePercentage: number | null;
  schedule: string;
  alarmId: string;
  cooldown: number;
};

export type AsConfiguration = {
  id: string;
  name: string;
  flavor: string;
  imageId: string;
  keyName: string;
  disks: Array<{ type: string; volumeType: string; size: number }>;
};

export type AsGroupDetail = {
  group: AsGroup;
  instances: AsInstance[];
  policies: AsPolicy[];
  configuration: AsConfiguration | null;
};

// All three list APIs use row offsets, including when they return a short page.
function asList(session: HuaweiProjectSession, path: string, field: string) {
  return huaweiList<Record<string, unknown>>(
    session,
    "as",
    `${path}?limit=100`,
    {
      items: [field],
      kind: "offset",
      parameter: "start_number",
      size: 100,
      total: ["total_number"],
    },
  );
}

export async function listAsGroupsForProject(session: HuaweiProjectSession) {
  const body = await asList(
    session,
    `/autoscaling-api/v1/${session.projectId}/scaling_group`,
    "scaling_groups",
  );
  return asArray(body.scaling_groups).map((value): AsGroup => {
    const item = asRecord(value);
    return {
      id: asString(item.scaling_group_id),
      name: asString(item.scaling_group_name),
      status: asString(item.scaling_group_status, "UNKNOWN"),
      projectId: session.projectId,
      projectName: session.projectName,
      region: session.region,
      current: Number(item.current_instance_number ?? 0),
      desired: Number(item.desire_instance_number ?? 0),
      minimum: Number(item.min_instance_number ?? 0),
      maximum: Number(item.max_instance_number ?? 0),
      configurationId: asString(item.scaling_configuration_id, ""),
      configurationName: asString(item.scaling_configuration_name),
      vpcId: asString(item.vpc_id),
      subnetIds: asArray(item.networks).map((network) =>
        asString(asRecord(network).id),
      ),
      availabilityZones: asArray(item.available_zones).map((zone) =>
        asString(zone),
      ),
      healthCheck: asString(item.health_periodic_audit_method),
      cooldown: Number(item.cool_down_time ?? 0),
      isScaling: item.is_scaling === true,
      createdAt: asString(item.create_time, ""),
      description: asString(item.description, ""),
    };
  });
}

export function listAsGroups(session: BetterUiSession) {
  return loadAcrossProjects(session, listAsGroupsForProject);
}

export async function listAsInstancesForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const body = await asList(
    session,
    `/autoscaling-api/v1/${session.projectId}/scaling_group_instance/${encodeURIComponent(id)}/list`,
    "scaling_group_instances",
  );
  return asArray(body.scaling_group_instances).map((value): AsInstance => {
    const item = asRecord(value);
    return {
      id: asString(item.instance_id),
      name: asString(item.instance_name),
      lifecycle: asString(item.life_cycle_state, "UNKNOWN"),
      health: asString(item.health_status, "UNKNOWN"),
      protected: item.protect_from_scaling_down === true,
      configurationName: asString(item.scaling_configuration_name),
      createdAt: asString(item.create_time, ""),
    };
  });
}

export async function listAsPoliciesForProject(
  session: HuaweiProjectSession,
  id: string,
) {
  const body = await asList(
    session,
    `/autoscaling-api/v1/${session.projectId}/scaling_policy/${encodeURIComponent(id)}/list`,
    "scaling_policies",
  );
  return asArray(body.scaling_policies).map((value): AsPolicy => {
    const item = asRecord(value);
    const action = asRecord(item.scaling_policy_action);
    const schedule = asRecord(item.scheduled_policy);
    return {
      id: asString(item.scaling_policy_id),
      name: asString(item.scaling_policy_name),
      type: asString(item.scaling_policy_type),
      status: asString(item.policy_status, "UNKNOWN"),
      operation: asString(action.operation),
      instanceNumber:
        action.instance_number == null ? null : Number(action.instance_number),
      instancePercentage:
        action.instance_percentage == null
          ? null
          : Number(action.instance_percentage),
      schedule: [
        schedule.launch_time,
        schedule.recurrence_type,
        schedule.recurrence_value,
      ]
        .filter(Boolean)
        .join(" · "),
      alarmId: asString(item.alarm_id, ""),
      cooldown: Number(item.cool_down_time ?? 0),
    };
  });
}

async function getAsConfiguration(
  session: HuaweiProjectSession,
  id: string,
): Promise<AsConfiguration | null> {
  if (!id) return null;
  const body = await huaweiFetch<{ scaling_configuration?: unknown }>(
    session,
    "as",
    `/autoscaling-api/v1/${session.projectId}/scaling_configuration/${encodeURIComponent(id)}`,
  );
  if (!body.scaling_configuration)
    throw new Error("Invalid AS configuration response.");
  const item = asRecord(body.scaling_configuration);
  const instance = asRecord(item.instance_config);
  // Whitelist display fields; passwords, injected files, and user_data never enter the cache.
  return {
    id: asString(item.scaling_configuration_id),
    name: asString(item.scaling_configuration_name),
    flavor: asString(instance.flavorRef),
    imageId: asString(instance.imageRef),
    keyName: asString(instance.key_name),
    disks: asArray(instance.disk).map((value) => {
      const disk = asRecord(value);
      return {
        type: asString(disk.disk_type),
        volumeType: asString(disk.volume_type),
        size: Number(disk.size ?? 0),
      };
    }),
  };
}

export function getAsGroup(
  session: BetterUiSession,
  id: string,
): Promise<AsGroupDetail | null> {
  return mapCloudLoad(
    () => listAsGroups(session),
    async (groups) => {
      const group = groups.find((item) => item.id === id);
      if (!group) return null;
      const project = projectForId(session, group.projectId);
      const results = await Promise.allSettled([
        listAsInstancesForProject(project, id),
        listAsPoliciesForProject(project, id),
        getAsConfiguration(project, group.configurationId),
      ]);
      return finishCloudLoad(
        results,
        {
          group,
          instances: settledValue(results[0], []),
          policies: settledValue(results[1], []),
          configuration: settledValue(results[2], null),
        },
        ["Instances", "Scaling policies", "Configuration"],
      );
    },
  );
}
