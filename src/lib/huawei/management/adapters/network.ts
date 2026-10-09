import "server-only";
import { isIP } from "node:net";

import type { BetterUiSession } from "@/lib/auth-session";
import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import { huaweiFetch, huaweiList } from "@/lib/huawei/http";
import { ManagementInputError } from "@/lib/management-contract";
import { asArray, asRecord, asString, firstString } from "@/lib/huawei/parsers";
import {
  listSecurityGroupsForProject,
  listSubnetsForProject,
  listVpcsForProject,
} from "@/lib/huawei/services/vpc";
import type { ManagementAdapter } from "../types";
import type { ManagementResource, ManagementValues } from "@/lib/management-contract";
import type { ManagementChoice } from "@/lib/management-contract";

/**
 * VPC networking management (VPC, subnets, security groups, security group
 * rules) against the documented native APIs:
 *   v3 VPCs           POST/PUT/DELETE /v3/{project_id}/vpc/vpcs[/{vpc_id}]
 *   v1 subnets        POST /v1/{project_id}/subnets,
 *                     PUT/DELETE /v1/{project_id}/vpcs/{vpc_id}/subnets/{subnet_id}
 *   v3 security       POST/PUT/DELETE /v3/{project_id}/vpc/security-groups[/{id}]
 *   v3 SG rules       GET/POST/DELETE /v3/{project_id}/vpc/security-group-rules[/{id}]
 *
 * The inventory mixes three resource families, so resource IDs are tagged
 * ("vpc:", "subnet:", "sg:") and every operation re-validates the family of
 * the selected resource inside execute before touching the API.
 * Subnet and security-group-rule operations select the parent resource and
 * validate the child ID against a fresh server query.
 */

const IPV4_SEGMENT = "(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)";
const IPV4_PATTERN = `^${IPV4_SEGMENT}(\\.${IPV4_SEGMENT}){3}$`;
const IPV4_CIDR_PATTERN = `^${IPV4_SEGMENT}(\\.${IPV4_SEGMENT}){3}/([89]|1[0-9]|2[0-9])$`;
const NAME_PATTERN =
  "^[\\p{L}\\p{N}](?:[\\p{L}\\p{N}_.-]{0,62}[\\p{L}\\p{N}])?$";
const DESCRIPTION_PATTERN = "^[^<>]*$";

const nameField = {
  key: "name",
  label: "Name",
  required: true,
  max: 64,
  pattern: NAME_PATTERN,
};
const descriptionField = {
  key: "description",
  label: "Description",
  type: "textarea" as const,
  max: 255,
  pattern: DESCRIPTION_PATTERN,
  help: "Optional. Angle brackets are not allowed.",
};

type VpcFamily = "vpc" | "subnet" | "sg";

function requireProjectId(session: BetterUiSession) {
  const projectId = session.projectId?.trim();
  if (!projectId)
    throw new ManagementInputError(
      "Select a project from this session first.",
      409,
    );
  return projectId;
}

/** Untag a tagged inventory ID and refuse the wrong resource family. */
function requireResourceKind(
  resource: ManagementResource | undefined,
  family: VpcFamily,
  label: string,
) {
  if (!resource?.id.startsWith(`${family}:`))
    throw new ManagementInputError(
      `This operation needs a selected ${label}.`,
      409,
    );
  return resource.id.slice(family.length + 1);
}

function text(value: ManagementValues[string] | undefined) {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function parseIpv4Cidr(cidr: string) {
  const match = /^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/.exec(cidr);
  if (!match) return null;
  const octets = match[1].split(".").map(Number);
  const prefix = Number(match[2]);
  if (
    octets.some((octet) => !Number.isInteger(octet) || octet > 255) ||
    prefix > 32
  )
    return null;
  const base =
    (((octets[0] << 24) | (octets[1] << 16) | (octets[2] << 8) | octets[3]) >>>
      0) >>>
    0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  return { base: (base & mask) >>> 0, mask, prefix };
}

function ipv4ToInt(address: string) {
  const octets = address.split(".");
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part)))
    return null;
  const numbers = octets.map(Number);
  if (numbers.some((number) => number > 255)) return null;
  return (((numbers[0] << 24) |
    (numbers[1] << 16) |
    (numbers[2] << 8) |
    numbers[3]) >>>
    0) >>>
    0;
}

function intToIpv4(value: number) {
  return [
    (value >>> 24) & 255,
    (value >>> 16) & 255,
    (value >>> 8) & 255,
    value & 255,
  ].join(".");
}

function cidrContains(parent: string, child: string) {
  const parentCidr = parseIpv4Cidr(parent);
  const childCidr = parseIpv4Cidr(child);
  return (
    !!parentCidr &&
    !!childCidr &&
    childCidr.prefix >= parentCidr.prefix &&
    (childCidr.base & parentCidr.mask) >>> 0 === parentCidr.base
  );
}

function ipInCidr(address: string, cidr: string) {
  const parsed = parseIpv4Cidr(cidr);
  const ip = ipv4ToInt(address);
  return !!parsed && ip !== null && (ip & parsed.mask) >>> 0 === parsed.base;
}

async function showVpc(session: BetterUiSession, projectId: string, vpcId: string) {
  const body = await huaweiFetch<{ vpc?: unknown }>(
    session,
    "vpc",
    `/v3/${encodeURIComponent(projectId)}/vpc/vpcs/${encodeURIComponent(vpcId)}`,
  );
  const vpc = asRecord(body.vpc);
  if (!vpc.id)
    throw new ManagementInputError(
      "The selected VPC no longer exists in this project.",
      404,
    );
  return {
    cidr: firstString([vpc.cidr, vpc.cidr_v4], ""),
    secondaryCidrs: asArray(vpc.extend_cidrs ?? vpc.ext_cidrs)
      .map((cidr) => (typeof cidr === "string" ? cidr : ""))
      .filter(Boolean),
  };
}

type RuleRecord = {
  id: string;
  securityGroupId: string;
  direction: string;
  protocol: string;
  multiport: string;
  remote: string;
  action: string;
};

/** Fresh security-group-rule query; optionally scoped to one group. */
async function fetchSecurityGroupRules(
  session: BetterUiSession,
  projectId: string,
  securityGroupId?: string,
): Promise<RuleRecord[]> {
  const query = new URLSearchParams({ limit: "200" });
  if (securityGroupId)
    query.set("security_group_id", securityGroupId);
  const body = await huaweiList<{ security_group_rules?: unknown[] }>(session, "vpc", `/v3/${encodeURIComponent(projectId)}/vpc/security-group-rules?${query}`, { items: ["security_group_rules"], kind: "marker", parameter: "marker", size: 200, next: ["page_info.next_marker"], fallbackKey: "id" });
  return asArray(body.security_group_rules).map((raw): RuleRecord => {
    const rule = asRecord(raw);
    return {
      id: asString(rule.id, ""),
      securityGroupId: asString(rule.security_group_id, ""),
      direction: asString(rule.direction, "ingress"),
      protocol: asString(rule.protocol, "any"),
      multiport: asString(rule.multiport, "ALL"),
      remote: firstString(
        [rule.remote_ip_prefix, rule.remote_group_id],
        "any",
      ),
      action: asString(rule.action, "allow"),
    };
  });
}

function ruleLabel(rule: RuleRecord, groupName: string) {
  return `${groupName} · ${rule.direction} · ${rule.protocol} · port ${rule.multiport} · ${rule.remote} (${rule.action})`;
}

export const networkManagement: ManagementAdapter = {
  title: "VPC Networking",
  operations: [
    {
      id: "create-vpc",
      label: "Create VPC",
      description:
        "Create a virtual private cloud network in the selected project.",
      kind: "create",
      fields: [
        nameField,
        {
          key: "cidr",
          label: "IPv4 CIDR block",
          required: true,
          max: 18,
          pattern: IPV4_CIDR_PATTERN.replace("2[0-9]", "2[0-8]"),
          help: "For example 192.168.0.0/16. Private IPv4 network, mask between /8 and /28.",
        },
        descriptionField,
      ],
    },
    {
      id: "update-vpc",
      label: "Edit VPC",
      description: "Rename the VPC or change its description.",
      kind: "update",
      fields: [nameField, descriptionField],
      allowedStatuses: ["ACTIVE"],
    },
    {
      id: "delete-vpc",
      label: "Delete VPC",
      description:
        "Permanently remove the VPC. Huawei rejects VPCs that still contain subnets or other resources.",
      kind: "delete",
      fields: [],
      confirmation: true,
      allowedStatuses: ["ACTIVE"],
      impact:
        "The VPC and its route configuration are permanently removed. Release subnets and resources inside it first.",
    },
    {
      id: "create-subnet",
      label: "Create subnet",
      description:
        "Add a subnet to an existing VPC of the selected project.",
      kind: "create",
      fields: [
        {
          key: "vpcId",
          label: "VPC",
          type: "select",
          required: true,
          source: "vpcs",
        },
        nameField,
        {
          key: "cidr",
          label: "Subnet IPv4 CIDR block",
          required: true,
          max: 18,
          pattern: IPV4_CIDR_PATTERN,
          help: "Must sit inside the VPC CIDR block, mask between /8 and /29.",
        },
        {
          key: "gatewayIp",
          label: "Gateway address",
          max: 15,
          pattern: IPV4_PATTERN,
          help: "Optional. Defaults to the first address of the subnet.",
        },
        descriptionField,
      ],
    },
    {
      id: "update-subnet",
      label: "Edit subnet",
      description:
        "Rename the selected subnet or change its description.",
      kind: "update",
      fields: [
        {
          key: "subnetId",
          label: "Subnet",
          type: "select",
          required: true,
          source: "subnets",
        },
        nameField,
        descriptionField,
      ],
      allowedStatuses: ["ACTIVE"],
    },
    {
      id: "delete-subnet",
      label: "Delete subnet",
      description:
        "Permanently remove the selected subnet. Huawei rejects subnets with in-use addresses.",
      kind: "delete",
      fields: [
        {
          key: "subnetId",
          label: "Subnet",
          type: "select",
          required: true,
          source: "subnets",
        },
      ],
      confirmation: true,
      allowedStatuses: ["ACTIVE"],
      impact:
        "The subnet and all of its private IP addresses are permanently removed.",
    },
    {
      id: "create-sg",
      label: "Create security group",
      description:
        "Create a security group in the selected project. Review the default ingress and egress rules after creation.",
      kind: "create",
      fields: [nameField, descriptionField],
    },
    {
      id: "update-sg",
      label: "Edit security group",
      description: "Rename the security group or change its description.",
      kind: "update",
      fields: [nameField, descriptionField],
    },
    {
      id: "delete-sg",
      label: "Delete security group",
      description:
        "Permanently remove the security group. Huawei rejects groups still attached to ports or instances.",
      kind: "delete",
      fields: [],
      confirmation: true,
      impact:
        "The security group and its rules are permanently removed for every attached resource.",
    },
    {
      id: "sg-rules",
      label: "View security group rules",
      description:
        "List the ingress and egress rules currently attached to the security group.",
      kind: "inspect",
      fields: [],
    },
    {
      id: "add-sg-rule",
      label: "Add security group rule",
      description:
        "Append one inbound or outbound rule to the selected security group.",
      kind: "action",
      fields: [
        {
          key: "direction",
          label: "Direction",
          type: "select",
          required: true,
          defaultValue: "ingress",
          choices: [
            { value: "ingress", label: "Inbound (ingress)" },
            { value: "egress", label: "Outbound (egress)" },
          ],
        },
        {
          key: "ethertype",
          label: "IP version",
          type: "select",
          required: true,
          defaultValue: "IPv4",
          choices: [
            { value: "IPv4", label: "IPv4" },
            { value: "IPv6", label: "IPv6" },
          ],
        },
        {
          key: "protocol",
          label: "Protocol",
          type: "select",
          required: true,
          defaultValue: "tcp",
          choices: [
            { value: "tcp", label: "TCP" },
            { value: "udp", label: "UDP" },
            { value: "icmp", label: "ICMP" },
            { value: "icmpv6", label: "ICMPv6" },
            { value: "any", label: "All protocols" },
          ],
        },
        {
          key: "portRange",
          label: "Port or port range",
          max: 64,
          pattern: "^\\d{1,5}(-\\d{1,5})?(,\\d{1,5}(-\\d{1,5})?)*$",
          help: "For example 80, 1-30, or 22,3389,80. Leave empty for all ports.",
        },
        {
          key: "remoteType",
          label: "Remote source",
          type: "select",
          required: true,
          defaultValue: "cidr",
          choices: [
            { value: "cidr", label: "IP address or CIDR block" },
            { value: "sg", label: "Another security group" },
            { value: "any", label: "Any remote address" },
          ],
        },
        {
          key: "remoteCidr",
          label: "Remote IP or CIDR",
          max: 45,
          help: "Required for a remote source of type IP address, for example 0.0.0.0/0.",
        },
        {
          key: "remoteGroup",
          label: "Remote security group",
          type: "select",
          source: "securityGroups",
        },
        {
          key: "action",
          label: "Policy",
          type: "select",
          required: true,
          defaultValue: "allow",
          choices: [
            { value: "allow", label: "Allow" },
            { value: "deny", label: "Deny" },
          ],
        },
        {
          key: "priority",
          label: "Priority (1 highest)",
          type: "number",
          min: 1,
          max: 100,
          defaultValue: 100,
        },
        {
          key: "description",
          label: "Rule description",
          max: 255,
          pattern: DESCRIPTION_PATTERN,
        },
      ],
      impact:
        "Open inbound rules expose the attached instances to the remote addresses you enter.",
    },
    {
      id: "delete-sg-rule",
      label: "Delete security group rule",
      description:
        "Remove one rule from the selected security group after re-checking it server-side.",
      kind: "delete",
      fields: [
        {
          key: "ruleId",
          label: "Rule",
          type: "select",
          required: true,
          source: "sgRules",
        },
      ],
      confirmation: true,
      impact:
        "Traffic permitted or denied by this rule stops being filtered by it immediately.",
    },
  ],
  inventory: async (session) => {
    const [vpcs, subnets, groups] = await Promise.all([
      listVpcsForProject(session),
      listSubnetsForProject(session),
      listSecurityGroupsForProject(session),
    ]);
    return [
      ...vpcs.map((vpc) => ({
        id: `vpc:${vpc.id}`,
        name: vpc.name,
        status: vpc.status,
        values: {
          name: vpc.name,
          description: vpc.description,
          cidr: vpc.cidr,
        },
      })),
      ...subnets.map((subnet) => ({
        id: `subnet:${subnet.id}`,
        name: subnet.name,
        status: subnet.status,
        values: {
          name: subnet.name,
          description: subnet.description,
          cidr: subnet.cidr,
          vpcId: subnet.vpcId,
          gateway: subnet.gateway,
        },
      })),
      ...groups.map((group) => ({
        id: `sg:${group.id}`,
        name: group.name,
        values: {
          name: group.name,
          description: group.description,
          rules: group.rules,
        },
      })),
    ];
  },
  options: async (session, operation, resource) => {
    const sources: Record<string, ManagementChoice[]> = {};
    if (operation === "create-subnet")
      sources.vpcs = (await listVpcsForProject(session)).map((vpc) => ({
        value: vpc.id,
        label: `${vpc.name} (${vpc.cidr})`,
      }));
    if (operation === "add-sg-rule")
      sources.securityGroups = (
        await listSecurityGroupsForProject(session)
      ).map((group) => ({ value: group.id, label: group.name }));
    if (operation === "delete-sg-rule") {
      const [groups, rules] = await Promise.all([
        listSecurityGroupsForProject(session),
        fetchSecurityGroupRules(session, requireProjectId(session), resource?.id.startsWith("sg:") ? resource.id.slice(3) : "unselected"),
      ]);
      const names = new Map(groups.map((group) => [group.id, group.name]));
      sources.sgRules = rules
        .filter((rule) => rule.id)
        .map((rule) => ({
          value: rule.id,
          label: ruleLabel(
            rule,
            names.get(rule.securityGroupId) ?? "Security group",
          ),
        }));
    }
    return sources;
  },
  invalidationKeys: (resource) => {
    const keys: string[] = [
      cloudCacheKeys.listVpcs,
      cloudCacheKeys.listSubnets,
      cloudCacheKeys.listSecurityGroups,
    ];
    if (resource?.id.startsWith("vpc:"))
      keys.push(cloudCacheKeys.vpc(resource.id.slice(4)));
    if (resource?.id.startsWith("subnet:"))
      keys.push(cloudCacheKeys.subnet(resource.id.slice(7)));
    if (resource?.id.startsWith("sg:"))
      keys.push(cloudCacheKeys.securityGroup(resource.id.slice(3)));
    if (resource?.values?.vpcId) keys.push(cloudCacheKeys.vpc(String(resource.values.vpcId)));
    return keys;
  },
  execute: async (session, operation, values, resource) => {
    const projectId = requireProjectId(session);
    const vpcsBase = `/v3/${encodeURIComponent(projectId)}/vpc/vpcs`;
    const subnetsBase = `/v1/${encodeURIComponent(projectId)}/subnets`;
    const groupsBase = `/v3/${encodeURIComponent(projectId)}/vpc/security-groups`;
    const rulesBase = `/v3/${encodeURIComponent(projectId)}/vpc/security-group-rules`;
    const name = text(values.name);
    const description = text(values.description);

    if (operation === "create-vpc") {
      const network = parseIpv4Cidr(String(values.cidr));
      const base = network?.base ?? 0;
      const privateRanges = ["10.0.0.0/8", "172.16.0.0/12", "192.168.0.0/16"];
      if (!network || !privateRanges.some((parent) => cidrContains(parent, String(values.cidr))) || String(values.cidr).split("/")[0] !== intToIpv4(base)) throw new ManagementInputError("Use an aligned private IPv4 network inside 10/8, 172.16/12, or 192.168/16.");
      const body = await huaweiFetch<{ vpc?: unknown }>(session, "vpc", vpcsBase, {
        method: "POST",
        body: JSON.stringify({
          vpc: {
            name,
            cidr: String(values.cidr),
            ...(description ? { description } : {}),
          },
        }),
      });
      return {
        message: "VPC created.",
        resourceId: asString(asRecord(body.vpc).id, "") || undefined,
      };
    }

    if (operation === "update-vpc") {
      const vpcId = requireResourceKind(resource, "vpc", "VPC");
      await huaweiFetch(session, "vpc", `${vpcsBase}/${encodeURIComponent(vpcId)}`, {
        method: "PUT",
        body: JSON.stringify({
          vpc: { name, ...(description ? { description } : {}) },
        }),
      });
      return { message: "VPC updated.", resourceId: vpcId };
    }

    if (operation === "delete-vpc") {
      const vpcId = requireResourceKind(resource, "vpc", "VPC");
      const body = await huaweiFetch<Record<string, unknown>>(
        session,
        "vpc",
        `${vpcsBase}/${encodeURIComponent(vpcId)}`,
        { method: "DELETE" },
      );
      return {
        message: "VPC deletion submitted.",
        resourceId: vpcId,
        asynchronous: true,
        jobId: asString(body.job_id, "") || undefined,
      };
    }

    if (operation === "create-subnet") {
      const vpcId = String(values.vpcId);
      const cidr = String(values.cidr);
      const vpc = await showVpc(session, projectId, vpcId);
      const parsedSubnet = parseIpv4Cidr(cidr);
      if (!parsedSubnet || cidr.split("/")[0] !== intToIpv4(parsedSubnet.base)) throw new ManagementInputError("Use an aligned subnet network address.");
      if (![vpc.cidr, ...vpc.secondaryCidrs].some((parent) => cidrContains(parent, cidr)))
        throw new ManagementInputError(
          "The subnet CIDR block must sit inside the VPC CIDR block.",
        );
      const gatewayIp =
        text(values.gatewayIp) ?? intToIpv4((parseIpv4Cidr(cidr)?.base ?? 0) + 1);
      const subnetCidr = parseIpv4Cidr(cidr);
      const gatewayNumber = ipv4ToInt(gatewayIp);
      if (!ipInCidr(gatewayIp, cidr) || gatewayNumber === subnetCidr?.base || gatewayNumber === ((subnetCidr!.base | ~subnetCidr!.mask) >>> 0))
        throw new ManagementInputError(
          "The gateway address must be an address inside the subnet CIDR block.",
        );
      const body = await huaweiFetch<{ subnet?: unknown }>(
        session,
        "vpc",
        subnetsBase,
        {
          method: "POST",
          body: JSON.stringify({
            subnet: {
              name,
              cidr,
              vpc_id: vpcId,
              gateway_ip: gatewayIp,
              ...(description ? { description } : {}),
            },
          }),
        },
      );
      return {
        message:
          "Subnet creation submitted. It becomes usable once its status is ACTIVE.",
        resourceId: asString(asRecord(body.subnet).id, "") || undefined,
        asynchronous: true,
      };
    }

    if (operation === "update-subnet" || operation === "delete-subnet") {
      const subnetId = requireResourceKind(resource, "subnet", "subnet");
      const subnet = (await listSubnetsForProject(session)).find((item) => item.id === subnetId);
      if (!subnet) throw new ManagementInputError("The subnet was not found in this project.", 404);
      const vpcId = subnet.vpcId;
      const path = `/v1/${encodeURIComponent(projectId)}/vpcs/${encodeURIComponent(vpcId)}/subnets/${encodeURIComponent(subnetId)}`;
      if (operation === "delete-subnet") {
        await huaweiFetch(session, "vpc", path, { method: "DELETE" });
        return {
          message: "Subnet deletion submitted.",
          resourceId: subnetId,
          asynchronous: true,
        };
      }
      await huaweiFetch(session, "vpc", path, {
        method: "PUT",
        body: JSON.stringify({
          subnet: { name, ...(description ? { description } : {}) },
        }),
      });
      return { message: "Subnet updated.", resourceId: subnetId };
    }

    if (operation === "create-sg") {
      const body = await huaweiFetch<{ security_group?: unknown }>(
        session,
        "vpc",
        groupsBase,
        {
          method: "POST",
          body: JSON.stringify({
            security_group: { name, ...(description ? { description } : {}) },
          }),
        },
      );
      return {
        message: "Security group created.",
        resourceId: asString(asRecord(body.security_group).id, "") || undefined,
      };
    }

    if (operation === "update-sg") {
      const groupId = requireResourceKind(resource, "sg", "security group");
      await huaweiFetch(
        session,
        "vpc",
        `${groupsBase}/${encodeURIComponent(groupId)}`,
        {
          method: "PUT",
          body: JSON.stringify({
            security_group: { name, ...(description ? { description } : {}) },
          }),
        },
      );
      return { message: "Security group updated.", resourceId: groupId };
    }

    if (operation === "delete-sg") {
      const groupId = requireResourceKind(resource, "sg", "security group");
      await huaweiFetch(
        session,
        "vpc",
        `${groupsBase}/${encodeURIComponent(groupId)}`,
        { method: "DELETE" },
      );
      return {
        message: "Security group deleted.",
        resourceId: groupId,
        asynchronous: true,
      };
    }

    if (operation === "sg-rules") {
      const groupId = requireResourceKind(resource, "sg", "security group");
      const rules = await fetchSecurityGroupRules(session, projectId, groupId);
      return {
        message: `${rules.length} rule${rules.length === 1 ? "" : "s"} attached to the security group.`,
        facts: rules.filter((rule) => rule.securityGroupId === groupId).map((rule) => ({
          label: `${rule.direction} · ${rule.protocol} · port ${rule.multiport} · ${rule.remote} (${rule.action})`,
          value: rule.id,
        })),
      };
    }

    if (operation === "add-sg-rule") {
      const groupId = requireResourceKind(resource, "sg", "security group");
      const protocol = String(values.protocol ?? "tcp");
      const ethertype = String(values.ethertype ?? "IPv4");
      const direction = String(values.direction ?? "ingress");
      const portRange = text(values.portRange);
      const remoteType = String(values.remoteType ?? "cidr");
      if (portRange && !["tcp", "udp"].includes(protocol))
        throw new ManagementInputError(
          "Ports can only be limited for TCP and UDP rules.",
        );
      if (portRange && portRange.split(",").some((part) => {
        const [start, end = start] = part.split("-").map(Number);
        return !Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || end < start;
      })) throw new ManagementInputError("Ports must be between 1 and 65535, with ranges in increasing order.");
      if ((protocol === "icmp" && ethertype !== "IPv4") || (protocol === "icmpv6" && ethertype !== "IPv6")) throw new ManagementInputError("The ICMP protocol must match the IP version.");
      const groups = await listSecurityGroupsForProject(session);
      if (!groups.some((group) => group.id === groupId))
        throw new ManagementInputError(
          "The selected security group no longer exists in this project.",
          404,
        );
      const rule: Record<string, unknown> = {
        security_group_id: groupId,
        direction,
        ethertype,
        action: String(values.action ?? "allow"),
        priority: typeof values.priority === "number" ? values.priority : 100,
      };
      if (protocol !== "any") rule.protocol = protocol;
      if (portRange) rule.multiport = portRange;
      if (remoteType === "cidr") {
        const remoteCidr = text(values.remoteCidr);
        if (!remoteCidr)
          throw new ManagementInputError(
            "Enter the remote IP address or CIDR block for this rule.",
          );
        const parts = remoteCidr.split("/");
        const version = ethertype === "IPv6" ? 6 : 4;
        if (parts.length > 2 || isIP(parts[0]) !== version || (parts.length === 2 && (!/^\d+$/.test(parts[1]) || Number(parts[1]) > (version === 6 ? 128 : 32)))) throw new ManagementInputError("Enter a valid remote address or CIDR matching the selected IP version.");
        rule.remote_ip_prefix = parts.length === 1 ? `${remoteCidr}/${version === 6 ? 128 : 32}` : remoteCidr;
      } else if (remoteType === "sg") {
        const remoteGroup = text(values.remoteGroup);
        if (!remoteGroup)
          throw new ManagementInputError(
            "Select the remote security group for this rule.",
          );
        if (!groups.some((group) => group.id === remoteGroup))
          throw new ManagementInputError(
            "The remote security group is not part of this project.",
            404,
          );
        rule.remote_group_id = remoteGroup;
      } else {
        rule.remote_ip_prefix = ethertype === "IPv6" ? "::/0" : "0.0.0.0/0";
      }
      const description = text(values.description);
      if (description) rule.description = description;
      const body = await huaweiFetch<{ security_group_rule?: unknown }>(
        session,
        "vpc",
        rulesBase,
        { method: "POST", body: JSON.stringify({ security_group_rule: rule }) },
      );
      return {
        message: "Security group rule added.",
        resourceId: groupId,
        facts: [
          {
            label: "New rule",
            value: asString(asRecord(body.security_group_rule).id, ""),
          },
        ],
      };
    }

    if (operation === "delete-sg-rule") {
      const groupId = requireResourceKind(resource, "sg", "security group");
      const ruleId = String(values.ruleId);
      const rules = await fetchSecurityGroupRules(session, projectId, groupId);
      if (!rules.some((rule) => rule.id === ruleId && rule.securityGroupId === groupId))
        throw new ManagementInputError(
          "The rule was not found in the selected security group.",
          404,
        );
      await huaweiFetch(
        session,
        "vpc",
        `${rulesBase}/${encodeURIComponent(ruleId)}`,
        { method: "DELETE" },
      );
      return {
        message: "Security group rule deleted.",
        resourceId: groupId,
      };
    }

    throw new ManagementInputError("Unsupported networking operation.");
  },
};


networkManagement.operations = networkManagement.operations.map((operation) => {
  if (operation.kind === "create") return operation;
  const family = operation.id.includes("subnet") ? "subnet:" : operation.id.includes("vpc") ? "vpc:" : "sg:";
  return { ...operation, resourcePrefixes: [family], fields: operation.fields.filter((field) => field.key !== "subnetId") };
});
