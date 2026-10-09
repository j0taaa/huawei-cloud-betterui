import { NextResponse } from "next/server";

import { getCurrentSession } from "@/lib/auth-session";
import {
  listCbrVaults,
  listCceClusters,
  listDcsRedisInstances,
  listDdsInstances,
  listDmsKafkaInstances,
  listDnsZones,
  listEcsInstances,
  listEips,
  listElbs,
  listEvsDisks,
  listFunctionGraphFunctions,
  listGaussDbInstances,
  listGeminiDbInstances,
  listImages,
  listNatGateways,
  listObsBuckets,
  listRdsInstances,
  listSecurityGroups,
  listSfsShares,
  listSmnTopics,
  listSubnets,
  listTaurusDbInstances,
  listVpcs,
} from "@/lib/huawei-cloud";

type SearchResource = {
  href: string;
  id: string;
  label: string;
  metadata: string;
  service: string;
  status: string;
};

type Loader = {
  load: () => Promise<SearchResource[]>;
  service: string;
};

const loaderTimeoutMs = 4_000;

function item({
  href,
  id,
  label,
  metadata,
  service,
  status = "-",
}: SearchResource) {
  return { href, id, label, metadata, service, status };
}

function withTimeout(loader: Loader) {
  return Promise.race([
    loader.load(),
    new Promise<SearchResource[]>((_, reject) => {
      setTimeout(
        () => reject(new Error(`${loader.service} resource search timed out.`)),
        loaderTimeoutMs,
      );
    }),
  ]);
}

export async function GET() {
  const session = await getCurrentSession();

  if (!session) {
    return NextResponse.json({ error: "Not signed in." }, { status: 401 });
  }

  const loaders: Loader[] = [
        {
          service: "ECS",
          load: async () =>
            (await listEcsInstances(session)).map((resource) =>
              item({
                href: `/services/ecs/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.privateIp} · ${resource.flavor} · ${resource.projectName} / ${resource.region}`,
                service: "ECS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "EVS",
          load: async () =>
            (await listEvsDisks(session)).map((resource) =>
              item({
                href: `/services/evs/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.size} · ${resource.typeLabel} · ${resource.projectName} / ${resource.region}`,
                service: "EVS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "IMS",
          load: async () =>
            (await listImages(session)).map((resource) =>
              item({
                href: `/services/ims/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.platform || resource.os} · ${resource.imageType} · ${resource.projectName} / ${resource.region}`,
                service: "IMS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "OBS",
          load: async () =>
            (await listObsBuckets(session)).map((resource) =>
              item({
                href: `/services/obs/${encodeURIComponent(resource.name)}`,
                id: resource.name,
                label: resource.name,
                metadata: `${resource.location || session.region} · ${resource.storageClass} · ${resource.size}`,
                service: "OBS",
                status: resource.type,
              }),
            ),
        },
        {
          service: "RDS",
          load: async () =>
            (await listRdsInstances(session)).map((resource) =>
              item({
                href: `/services/rds/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.datastore} · ${resource.privateIp} · ${resource.projectName} / ${resource.region}`,
                service: "RDS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "CCE",
          load: async () =>
            (await listCceClusters(session)).map((resource) =>
              item({
                href: `/services/cce/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.flavor} · ${resource.version} · ${resource.projectName} / ${resource.region}`,
                service: "CCE",
                status: resource.status,
              }),
            ),
        },
        {
          service: "ELB",
          load: async () =>
            (await listElbs(session)).map((resource) =>
              item({
                href: `/services/elb/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.vipAddress} · ${resource.listenerCount} listeners · ${resource.projectName} / ${resource.region}`,
                service: "ELB",
                status: resource.provisioningStatus,
              }),
            ),
        },
        {
          service: "EIP",
          load: async () =>
            (await listEips(session)).map((resource) =>
              item({
                href: "/services/eip",
                id: resource.id,
                label: resource.name || resource.ipAddress,
                metadata: `${resource.ipAddress} · ${resource.associatedInstanceType || "Unbound"} · ${resource.projectName} / ${resource.region}`,
                service: "EIP",
                status: resource.status,
              }),
            ),
        },
        {
          service: "VPC",
          load: async () =>
            (await listVpcs(session)).map((resource) =>
              item({
                href: `/services/network/vpcs/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.cidr} · ${resource.projectName} / ${resource.region}`,
                service: "VPC",
                status: resource.status,
              }),
            ),
        },
        {
          service: "Subnet",
          load: async () =>
            (await listSubnets(session)).map((resource) =>
              item({
                href: `/services/network/subnets/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.cidr} · ${resource.gateway} · ${resource.projectName} / ${resource.region}`,
                service: "Subnet",
                status: resource.status,
              }),
            ),
        },
        {
          service: "Security Group",
          load: async () =>
            (await listSecurityGroups(session)).map((resource) =>
              item({
                href: `/services/network/security-groups/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.rules} rules · ${resource.projectName} / ${resource.region}`,
                service: "Security Group",
                status: resource.description || "-",
              }),
            ),
        },
        {
          service: "SFS",
          load: async () =>
            (await listSfsShares(session)).map((resource) =>
              item({
                href: "/services/sfs",
                id: resource.id,
                label: resource.name,
                metadata: `${resource.protocol} · ${resource.sizeGb} GB · ${resource.projectName} / ${resource.region}`,
                service: "SFS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "CBR",
          load: async () =>
            (await listCbrVaults(session)).map((resource) =>
              item({
                href: `/services/cbr/vaults/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.sizeGb} GB · ${resource.backupCount} backups · ${resource.projectName} / ${resource.region}`,
                service: "CBR",
                status: resource.status,
              }),
            ),
        },
        {
          service: "DCS",
          load: async () =>
            (await listDcsRedisInstances(session)).map((resource) =>
              item({
                href: `/services/dcs/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.engine} · ${resource.capacity} · ${resource.projectName} / ${resource.region}`,
                service: "DCS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "DDS",
          load: async () =>
            (await listDdsInstances(session)).map((resource) =>
              item({
                href: `/services/dds/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.datastore} · ${resource.mode} · ${resource.projectName} / ${resource.region}`,
                service: "DDS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "GaussDB",
          load: async () =>
            (await listGaussDbInstances(session)).map((resource) =>
              item({
                href: `/services/gaussdb/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.datastore} · ${resource.type} · ${resource.projectName} / ${resource.region}`,
                service: "GaussDB",
                status: resource.status,
              }),
            ),
        },
        {
          service: "TaurusDB",
          load: async () =>
            (await listTaurusDbInstances(session)).map((resource) =>
              item({
                href: `/services/taurusdb/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.datastore} · ${resource.storage} · ${resource.projectName} / ${resource.region}`,
                service: "TaurusDB",
                status: resource.status,
              }),
            ),
        },
        {
          service: "GeminiDB",
          load: async () =>
            (await listGeminiDbInstances(session)).map((resource) =>
              item({
                href: `/services/geminidb/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.engine} · ${resource.mode} · ${resource.projectName} / ${resource.region}`,
                service: "GeminiDB",
                status: resource.status,
              }),
            ),
        },
        {
          service: "DMS Kafka",
          load: async () =>
            (await listDmsKafkaInstances(session)).map((resource) =>
              item({
                href: `/services/dms-kafka/${resource.id}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.engineVersion} · ${resource.brokerCount} brokers · ${resource.projectName} / ${resource.region}`,
                service: "DMS Kafka",
                status: resource.status,
              }),
            ),
        },
        {
          service: "FunctionGraph",
          load: async () =>
            (await listFunctionGraphFunctions(session)).map((resource) =>
              item({
                href: `/services/functiongraph/${encodeURIComponent(resource.urn || resource.id)}`,
                id: resource.id,
                label: resource.name,
                metadata: `${resource.runtime} · ${resource.packageName} · ${resource.projectName} / ${resource.region}`,
                service: "FunctionGraph",
                status: resource.version,
              }),
            ),
        },
        {
          service: "NAT",
          load: async () =>
            (await listNatGateways(session)).map((resource) =>
              item({
                href: "/services/nat",
                id: resource.id,
                label: resource.name,
                metadata: `${resource.routerId} · ${resource.projectName} / ${resource.region}`,
                service: "NAT",
                status: resource.status,
              }),
            ),
        },
        {
          service: "DNS",
          load: async () =>
            (await listDnsZones(session)).map((resource) =>
              item({
                href: "/services/dns",
                id: resource.id,
                label: resource.name,
                metadata: `${resource.type} · ${resource.recordCount} records · ${resource.projectName} / ${resource.region}`,
                service: "DNS",
                status: resource.status,
              }),
            ),
        },
        {
          service: "SMN",
          load: async () =>
            (await listSmnTopics(session)).map((resource) =>
              item({
                href: "/services/smn",
                id: resource.topicUrn,
                label: resource.name,
                metadata: `${resource.displayName || resource.topicUrn} · ${resource.projectName} / ${resource.region}`,
                service: "SMN",
                status: resource.pushPolicy,
              }),
            ),
        },
  ];
  const loaded = await Promise.allSettled(loaders.map(withTimeout));
  const resources = loaded.flatMap((result) =>
    result.status === "fulfilled" ? result.value : [],
  );
  const errors = loaded.flatMap((result, index) =>
    result.status === "rejected"
      ? [
          {
            error:
              result.reason instanceof Error
                ? result.reason.message
                : "Resource search loader failed.",
            service: loaders[index]?.service ?? "Unknown",
          },
        ]
      : [],
  );

  return NextResponse.json({
    errors,
    resources,
    updatedAt: new Date().toISOString(),
  });
}
