"use client";

import Image from "next/image";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  Activity,
  ArrowRight,
  ArchiveRestore,
  BellRing,
  Box,
  BrainCircuit,
  Cable,
  CloudCog,
  Code2,
  Database,
  DatabaseZap,
  FolderTree,
  Globe2,
  HardDrive,
  Images,
  KeyRound,
  Layers3,
  Logs,
  MessageSquareMore,
  Monitor,
  Network,
  Route,
  Search,
  Server,
  ShieldAlert,
  ShieldCheck,
  Smartphone,
  ScrollText,
  X,
  type LucideIcon,
} from "lucide-react";

import { serviceLogos } from "@/lib/service-logos";

type Service = {
  name: string;
  shortName: string;
  category: string;
  description: string;
  href: string;
  icon: LucideIcon;
  aliases: string[];
  logo?: string;
};

const huaweiServices: Service[] = [
  {
    name: "Elastic Cloud Server",
    shortName: "ECS",
    category: "Compute",
    description: "Scalable virtual machines for general workloads.",
    href: "/services/ecs",
    icon: Server,
    logo: serviceLogos.ECS,
    aliases: ["vm", "virtual machine", "compute", "instance"],
  },
  {
    name: "Bare Metal Server",
    shortName: "BMS",
    category: "Compute",
    description: "Dedicated physical servers, flavors, images, and network addresses.",
    href: "/services/bms",
    icon: Server,
    logo: serviceLogos.BMS,
    aliases: ["bare metal", "physical server", "dedicated server", "compute"],
  },
  {
    name: "Dedicated Host",
    shortName: "DeH",
    category: "Compute",
    description: "Dedicated host pools with capacity, AZ placement, and ECS occupancy.",
    href: "/services/deh",
    icon: Server,
    logo: serviceLogos.DEH,
    aliases: ["dedicated host", "host pool", "byol", "isolation", "capacity"],
  },
  {
    name: "Cloud Phone Host",
    shortName: "CPH",
    category: "Compute",
    description: "Cloud phone servers, mobile device capacity, network exposure, and host flavor.",
    href: "/services/cph",
    icon: Smartphone,
    logo: serviceLogos.CPH,
    aliases: ["cloud phone", "android", "mobile testing", "phone server", "cph"],
  },
  {
    name: "Server Migration Service",
    shortName: "SMS",
    category: "Migration",
    description: "Server migration tasks with source, target, progress, and sync state.",
    href: "/services/sms",
    icon: Server,
    aliases: ["server migration", "sms", "migration task", "source server", "target server"],
  },
  {
    name: "Cloud Container Engine",
    shortName: "CCE",
    category: "Containers",
    description: "Managed Kubernetes clusters and container workloads.",
    href: "/services/cce",
    icon: Layers3,
    logo: serviceLogos.CCE,
    aliases: ["kubernetes", "k8s", "containers", "cluster"],
  },
  {
    name: "Cloud Container Instance",
    shortName: "CCI",
    category: "Containers",
    description: "Serverless container namespaces and pod readiness by region.",
    href: "/services/cci",
    icon: Layers3,
    logo: serviceLogos.CCI,
    aliases: ["serverless containers", "pod", "namespace", "cci2"],
  },
  {
    name: "Software Repository for Container",
    shortName: "SWR",
    category: "Containers",
    description: "Container image repositories, tags, scans, and pull access.",
    href: "/services/swr",
    icon: Code2,
    logo: serviceLogos.SWR,
    aliases: ["registry", "container registry", "image", "docker", "artifact"],
  },
  {
    name: "Auto Scaling",
    shortName: "AS",
    category: "Compute",
    description: "Automatically adjust ECS capacity based on demand.",
    href: "/services/as",
    icon: Activity,
    logo: serviceLogos.AS,
    aliases: ["scaling", "autoscale", "capacity"],
  },
  {
    name: "FunctionGraph",
    shortName: "FunctionGraph",
    category: "Compute",
    description: "Event-driven serverless functions and cloud workflows.",
    href: "/services/functiongraph",
    icon: Code2,
    logo: serviceLogos.FG,
    aliases: ["function", "serverless", "lambda", "faas", "event", "workflow"],
  },
  {
    name: "Object Storage Service",
    shortName: "OBS",
    category: "Storage",
    description: "Object buckets for files, backups, and static assets.",
    href: "/services/obs",
    icon: Box,
    logo: serviceLogos.OBS,
    aliases: ["bucket", "object", "storage", "s3"],
  },
  {
    name: "Elastic Volume Service",
    shortName: "EVS",
    category: "Storage",
    description: "Block storage volumes for cloud servers.",
    href: "/services/evs",
    icon: HardDrive,
    logo: serviceLogos.EVS,
    aliases: ["disk", "volume", "block storage"],
  },
  {
    name: "Scalable File Service",
    shortName: "SFS",
    category: "Storage",
    description: "Shared file storage for multiple cloud servers.",
    href: "/services/sfs",
    icon: FolderTree,
    logo: serviceLogos.SFS,
    aliases: ["file", "nfs", "shared storage"],
  },
  {
    name: "Cloud Backup and Recovery",
    shortName: "CBR",
    category: "Storage",
    description: "Backup vaults for servers, disks, and file systems.",
    href: "/services/cbr",
    icon: ArchiveRestore,
    logo: serviceLogos.CBR,
    aliases: ["backup", "vault", "restore", "snapshot"],
  },
  {
    name: "Object Storage Migration Service",
    shortName: "OMS",
    category: "Migration",
    description: "Object migration tasks, source cloud, bucket path, progress, and failed objects.",
    href: "/services/oms",
    icon: Box,
    aliases: ["object migration", "bucket migration", "oms", "sync task", "source cloud"],
  },
  {
    name: "Storage Disaster Recovery Service",
    shortName: "SDRS",
    category: "Migration",
    description: "Protected instances, production and DR server mapping, and replication pair coverage.",
    href: "/services/sdrs",
    icon: ArchiveRestore,
    aliases: ["disaster recovery", "sdrs", "protected instance", "replication pair", "dr"],
  },
  {
    name: "Migration Center",
    shortName: "MGC",
    category: "Migration",
    description: "Migration-center rollup across SMS, OMS, and CDM activity.",
    href: "/services/mgc",
    icon: Route,
    aliases: ["migration center", "mgc", "migration workflow", "application migration", "storage migration"],
  },
  {
    name: "Image Management Service",
    shortName: "IMS",
    category: "Compute",
    description: "Private images available for server provisioning.",
    href: "/services/ims",
    icon: Images,
    logo: serviceLogos.IMS,
    aliases: ["image", "ami", "os image", "private image"],
  },
  {
    name: "Virtual Private Cloud",
    shortName: "VPC",
    category: "Networking",
    description: "Private networks, subnets, routes, and security groups.",
    href: "/services/network",
    icon: Network,
    logo: serviceLogos.VPC,
    aliases: ["network", "subnet", "route", "security group"],
  },
  {
    name: "Elastic IP",
    shortName: "EIP",
    category: "Networking",
    description: "Public IP addresses for internet-facing resources.",
    href: "/services/eip",
    icon: Globe2,
    logo: serviceLogos.EIP,
    aliases: ["public ip", "internet ip", "ipv4"],
  },
  {
    name: "NAT Gateway",
    shortName: "NAT",
    category: "Networking",
    description: "SNAT and DNAT gateways for private subnet connectivity.",
    href: "/services/nat",
    icon: Route,
    logo: serviceLogos.NAT,
    aliases: ["snat", "dnat", "nat gateway", "egress"],
  },
  {
    name: "Direct Connect",
    shortName: "DC",
    category: "Networking",
    description: "Dedicated line inventory with bandwidth, port, provider, and location.",
    href: "/services/direct-connect",
    icon: Cable,
    logo: serviceLogos.DC,
    aliases: ["direct connect", "dedicated line", "private circuit", "connection"],
  },
  {
    name: "Enterprise Router",
    shortName: "ER",
    category: "Networking",
    description: "Cloud routing hubs with ASN, route-table defaults, and sharing posture.",
    href: "/services/enterprise-router",
    icon: Route,
    aliases: ["enterprise router", "er", "cloud router", "routing hub", "asn"],
  },
  {
    name: "Virtual Private Network",
    shortName: "VPN",
    category: "Networking",
    description: "Encrypted site-to-site VPC connectivity.",
    href: "/services/vpn",
    icon: Cable,
    logo: serviceLogos.VPN,
    aliases: ["ipsec", "site to site", "tunnel", "customer gateway"],
  },
  {
    name: "VPC Endpoint",
    shortName: "VPCEP",
    category: "Networking",
    description: "Private endpoints with service name, VPC/subnet placement, IP, and DNS.",
    href: "/services/vpc-endpoint",
    icon: Network,
    logo: serviceLogos.VPCEP,
    aliases: ["vpc endpoint", "privatelink", "private service", "endpoint service"],
  },
  {
    name: "Elastic Load Balance",
    shortName: "ELB",
    category: "Networking",
    description: "Distribute traffic across servers and services.",
    href: "/services/elb",
    icon: CloudCog,
    logo: serviceLogos.ELB,
    aliases: ["load balancer", "traffic", "balancing"],
  },
  {
    name: "Domain Name Service",
    shortName: "DNS",
    category: "Networking",
    description: "Public and private zones, record counts, and DNS status.",
    href: "/services/dns",
    icon: Globe2,
    logo: serviceLogos.DNS,
    aliases: ["domain", "zone", "record", "ttl", "nameserver"],
  },
  {
    name: "Content Delivery Network",
    shortName: "CDN",
    category: "Networking",
    description: "Acceleration domains, origins, CNAMEs, and service areas.",
    href: "/services/cdn",
    icon: CloudCog,
    aliases: ["content delivery", "acceleration", "origin", "cname", "edge"],
  },
  {
    name: "API Gateway",
    shortName: "APIG",
    category: "Networking",
    description: "Dedicated gateways, VPC placement, status, and EIP access.",
    href: "/services/apig",
    icon: CloudCog,
    aliases: ["api", "gateway", "dedicated gateway", "apigw"],
  },
  {
    name: "Security Groups",
    shortName: "SG",
    category: "Networking",
    description: "Stateful virtual firewalls for ECS, CCE, and database traffic.",
    href: "/services/network",
    icon: ShieldCheck,
    logo: serviceLogos.VPC,
    aliases: ["security group", "firewall", "inbound", "outbound", "rules"],
  },
  {
    name: "Subnets",
    shortName: "Subnet",
    category: "Networking",
    description: "IP ranges and gateway configuration inside VPC networks.",
    href: "/services/network",
    icon: Network,
    logo: serviceLogos.VPC,
    aliases: ["cidr", "gateway", "ip range", "network segment"],
  },
  {
    name: "Relational Database Service",
    shortName: "RDS",
    category: "Database",
    description: "Managed MySQL, PostgreSQL, and SQL Server databases.",
    href: "/services/rds",
    icon: Database,
    logo: serviceLogos.RDS,
    aliases: ["mysql", "postgres", "sql", "database"],
  },
  {
    name: "GaussDB",
    shortName: "GaussDB",
    category: "Databases",
    description: "openGauss database instances, topology, storage, and private access.",
    href: "/services/gaussdb",
    icon: Database,
    logo: serviceLogos.GAUSSDB,
    aliases: ["opengauss", "distributed database", "enterprise database"],
  },
  {
    name: "Document Database Service",
    shortName: "DDS",
    category: "Databases",
    description: "MongoDB-compatible document database instances and topology.",
    href: "/services/dds",
    icon: Database,
    logo: serviceLogos.DDS,
    aliases: ["mongodb", "document database", "replica set", "cluster"],
  },
  {
    name: "Distributed Cache Service",
    shortName: "DCS",
    category: "Databases",
    description: "Managed Redis cache instances, memory, topology, and endpoints.",
    href: "/services/dcs",
    icon: DatabaseZap,
    logo: serviceLogos.DCS,
    aliases: ["redis", "memcached", "cache"],
  },
  {
    name: "Distributed Message Service for Kafka",
    shortName: "DMS Kafka",
    category: "Databases",
    description: "Managed Kafka clusters, brokers, partitions, and endpoints.",
    href: "/services/dms-kafka",
    icon: MessageSquareMore,
    aliases: ["kafka", "broker", "topic", "message queue", "streaming"],
  },
  {
    name: "Data Replication Service",
    shortName: "DRS",
    category: "Databases",
    description: "Migration, synchronization, and disaster recovery jobs.",
    href: "/services/drs",
    icon: ArrowRight,
    logo: serviceLogos.DRS,
    aliases: ["migration", "replication", "sync", "disaster recovery"],
  },
  {
    name: "TaurusDB",
    shortName: "TaurusDB",
    category: "Databases",
    description: "MySQL-compatible TaurusDB instances and private endpoints.",
    href: "/services/taurusdb",
    icon: DatabaseZap,
    logo: serviceLogos.GAUSSDB,
    aliases: ["gaussdb mysql", "mysql", "taurus", "cloud native database"],
  },
  {
    name: "GeminiDB",
    shortName: "GeminiDB",
    category: "Databases",
    description: "Cassandra, Mongo, Influx, and Redis-compatible NoSQL instances.",
    href: "/services/geminidb",
    icon: Database,
    logo: serviceLogos.GAUSSDB,
    aliases: ["nosql", "cassandra", "mongo", "influx", "redis", "multi model"],
  },
  {
    name: "ModelArts",
    shortName: "ModelArts",
    category: "Analytics",
    description: "AI notebook instances, compute flavor, image, workspace, and resource pool.",
    href: "/services/modelarts",
    icon: BrainCircuit,
    aliases: ["ai", "machine learning", "notebook", "model", "training", "workspace"],
  },
  {
    name: "Data Lake Insight",
    shortName: "DLI",
    category: "Analytics",
    description: "SQL, Spark, and Flink queues with CUs, owners, and billing posture.",
    href: "/services/dli",
    icon: DatabaseZap,
    aliases: ["lakehouse", "sql queue", "spark", "flink", "queue", "cu"],
  },
  {
    name: "MapReduce Service",
    shortName: "MRS",
    category: "Analytics",
    description: "Big data clusters with Hadoop version, components, and node topology.",
    href: "/services/mrs",
    icon: Layers3,
    aliases: ["hadoop", "spark", "hbase", "hive", "big data", "cluster"],
  },
  {
    name: "Data Warehouse Service",
    shortName: "DWS",
    category: "Analytics",
    description: "GaussDB(DWS) warehouse clusters, node types, and private endpoints.",
    href: "/services/dws",
    icon: Database,
    logo: serviceLogos.DWS,
    aliases: ["warehouse", "gaussdb dws", "analytics", "mpp", "cluster"],
  },
  {
    name: "Cloud Search Service",
    shortName: "CSS",
    category: "Search",
    description: "Elasticsearch and OpenSearch clusters, node specs, and endpoints.",
    href: "/services/css",
    icon: Search,
    aliases: ["elasticsearch", "opensearch", "search", "index", "kibana"],
  },
  {
    name: "Cloud Data Migration",
    shortName: "CDM",
    category: "Analytics",
    description: "Data migration clusters, runtime status, node topology, and access endpoints.",
    href: "/services/cdm",
    icon: DatabaseZap,
    aliases: ["data migration", "cdm", "etl", "migration cluster", "data integration"],
  },
  {
    name: "DataArts Studio",
    shortName: "DataArts",
    category: "Analytics",
    description: "Data governance instances, editions, workspaces, and lifecycle status.",
    href: "/services/dataarts",
    icon: FolderTree,
    aliases: ["dataarts", "data governance", "data catalog", "data factory", "workspace"],
  },
  {
    name: "Identity and Access Management",
    shortName: "IAM",
    category: "Security",
    description: "Users, groups, permissions, policies, and access keys.",
    href: "/services/iam",
    icon: KeyRound,
    logo: serviceLogos.IAM,
    aliases: ["identity", "permission", "policy", "user", "access"],
  },
  {
    name: "Web Application Firewall",
    shortName: "WAF",
    category: "Security",
    description: "Protected hostnames, access state, proxy mode, and policy posture.",
    href: "/services/waf",
    icon: ShieldCheck,
    logo: serviceLogos.WAF,
    aliases: ["firewall", "web security", "api protection", "protected host", "policy"],
  },
  {
    name: "Data Encryption Workshop",
    shortName: "DEW",
    category: "Security",
    description: "KMS keys, key lifecycle, rotation posture, and secret metadata.",
    href: "/services/dew",
    icon: KeyRound,
    logo: serviceLogos.DEW,
    aliases: ["kms", "key", "encryption", "secrets", "csms", "rotation"],
  },
  {
    name: "Host Security Service",
    shortName: "HSS",
    category: "Security",
    description: "Host agent health, vulnerabilities, baseline risks, and intrusions.",
    href: "/services/hss",
    icon: Server,
    logo: serviceLogos.HSS,
    aliases: ["host security", "agent", "vulnerability", "server risk", "baseline", "intrusion"],
  },
  {
    name: "Cloud Bastion Host",
    shortName: "CBH",
    category: "Security",
    description: "Bastion host instances, version posture, access addresses, and upgrade state.",
    href: "/services/cbh",
    icon: KeyRound,
    aliases: ["bastion", "jump host", "privileged access", "cbh", "audit"],
  },
  {
    name: "SecMaster",
    shortName: "SecMaster",
    category: "Security",
    description: "Security operation workspaces, views, regions, and enterprise project scope.",
    href: "/services/secmaster",
    icon: ShieldCheck,
    aliases: ["security operations", "workspace", "soc", "incident", "secmaster"],
  },
  {
    name: "Cloud Firewall",
    shortName: "CFW",
    category: "Security",
    description: "Firewall instances, north-south/east-west border type, and protected capacity.",
    href: "/services/cfw",
    icon: ShieldAlert,
    logo: serviceLogos.CFW,
    aliases: ["firewall", "cloud firewall", "eip protection", "vpc protection", "cfw"],
  },
  {
    name: "Workspace",
    shortName: "Workspace",
    category: "Security",
    description: "Cloud desktop tenant access mode, VPC placement, service subnets, and security group.",
    href: "/services/workspace",
    icon: Monitor,
    aliases: ["cloud desktop", "desktop", "workspace", "vdi", "enterprise id"],
  },
  {
    name: "Cloud Eye",
    shortName: "CES",
    category: "Monitoring",
    description: "Alarm rules, metric namespaces, notification actions, and resource coverage.",
    href: "/services/ces",
    icon: Activity,
    logo: serviceLogos.CES,
    aliases: ["monitoring", "alarm", "metric", "observability"],
  },
  {
    name: "Log Tank Service",
    shortName: "LTS",
    category: "Monitoring",
    description: "Log groups, retention, and log collection targets.",
    href: "/services/lts",
    icon: Logs,
    logo: serviceLogos.LTS,
    aliases: ["logs", "log group", "retention"],
  },
  {
    name: "Cloud Trace Service",
    shortName: "CTS",
    category: "Monitoring",
    description: "Trackers and audit event delivery.",
    href: "/services/cts",
    icon: ScrollText,
    logo: serviceLogos.CTS,
    aliases: ["audit", "trace", "tracker", "operations"],
  },
  {
    name: "Simple Message Notification",
    shortName: "SMN",
    category: "Monitoring",
    description: "Notification topics, subscriptions, and delivery policies.",
    href: "/services/smn",
    icon: BellRing,
    aliases: ["notification", "topic", "subscription", "message", "pubsub"],
  },
];

const normalize = (value: string) => value.toLowerCase().trim();

export function ServiceCommandSearch() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  const closeSearch = useCallback(() => {
    setOpen(false);
    setQuery("");
    setSelectedIndex(0);
  }, []);

  const filteredServices = useMemo(() => {
    const term = normalize(query);

    if (!term) {
      return huaweiServices;
    }

    return huaweiServices.filter((service) =>
      [
        service.name,
        service.shortName,
        service.category,
        service.description,
        ...service.aliases,
      ]
        .map(normalize)
        .some((value) => value.includes(term)),
    );
  }, [query]);

  const selectedServiceIndex =
    filteredServices.length === 0
      ? 0
      : Math.min(selectedIndex, filteredServices.length - 1);

  const openSelectedService = useCallback(() => {
    const selectedService = filteredServices[selectedServiceIndex];

    if (!selectedService) {
      return;
    }

    closeSearch();
    window.location.href = selectedService.href;
  }, [closeSearch, filteredServices, selectedServiceIndex]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      const isCommandSearch =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (isCommandSearch) {
        event.preventDefault();
        setOpen(true);
      }

      if (event.key === "Escape") {
        closeSearch();
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [closeSearch]);

  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  return (
    <>
      <button
        className="flex h-11 w-full items-center gap-3 rounded-lg border border-[#d9e0eb] bg-white px-4 text-left text-sm font-medium text-[#667085] shadow-sm transition hover:border-[#b8c3d7] hover:bg-[#fbfcfe] lg:max-w-xl"
        onClick={() => setOpen(true)}
        type="button"
      >
        <Search className="size-5" />
        <span className="min-w-0 flex-1 truncate">
          Search Huawei Cloud services...
        </span>
        <kbd className="rounded-md bg-[#f2f4f7] px-2 py-1 text-xs font-bold text-[#667085]">
          ⌘ K
        </kbd>
      </button>

      {open && typeof document !== "undefined"
        ? createPortal(
        <div
          aria-modal="true"
          className="fixed inset-0 z-[100] flex items-start justify-center bg-[#101828]/35 px-4 pb-8 pt-20 backdrop-blur-sm sm:pt-24"
          onMouseDown={closeSearch}
          role="dialog"
        >
          <div
            className="w-full max-w-2xl overflow-hidden rounded-2xl border border-[#d9e0eb] bg-white shadow-[0_24px_80px_rgba(16,24,40,0.22)]"
            onMouseDown={(event) => event.stopPropagation()}
          >
            <div className="flex items-center gap-3 border-b border-[#e4e9f2] px-5 py-4">
              <Search className="size-5 text-[#667085]" />
              <input
                aria-label="Search Huawei Cloud services"
                className="min-w-0 flex-1 bg-transparent text-base font-semibold outline-none placeholder:text-[#98a2b3]"
                onChange={(event) => {
                  setQuery(event.target.value);
                  setSelectedIndex(0);
                }}
                onKeyDown={(event) => {
                  if (event.key === "ArrowDown") {
                    event.preventDefault();
                    setSelectedIndex((currentIndex) =>
                      filteredServices.length === 0
                        ? 0
                        : (currentIndex + 1) % filteredServices.length,
                    );
                  }

                  if (event.key === "ArrowUp") {
                    event.preventDefault();
                    setSelectedIndex((currentIndex) =>
                      filteredServices.length === 0
                        ? 0
                        : (currentIndex - 1 + filteredServices.length) %
                          filteredServices.length,
                    );
                  }

                  if (event.key === "Enter") {
                    event.preventDefault();
                    openSelectedService();
                  }
                }}
                placeholder="Search ECS, OBS, VPC, RDS, IAM..."
                ref={inputRef}
                value={query}
              />
              <button
                aria-label="Close search"
                className="grid size-8 place-items-center rounded-lg text-[#667085] hover:bg-[#f2f4f7]"
                onClick={closeSearch}
                type="button"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[520px] overflow-y-auto p-2">
              {filteredServices.length > 0 ? (
                filteredServices.map((service, index) => {
                  const Icon = service.icon;
                  const isSelected = index === selectedServiceIndex;

                  return (
                    <a
                      aria-selected={isSelected}
                      className={
                        isSelected
                          ? "flex items-center gap-4 rounded-xl bg-[#eef4ff] p-4 transition"
                          : "flex items-center gap-4 rounded-xl p-4 transition hover:bg-[#f4f7fb]"
                      }
                      href={service.href}
                      key={`${service.category}-${service.shortName}`}
                      onClick={closeSearch}
                      onMouseEnter={() => setSelectedIndex(index)}
                      role="option"
                    >
                      <div
                        className={
                          isSelected
                            ? "grid size-11 place-items-center rounded-xl bg-white text-[#2563eb] shadow-sm"
                            : "grid size-11 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]"
                        }
                      >
                        {service.logo ? (
                          <Image
                            alt={`${service.shortName} logo`}
                            className="size-7 object-contain"
                            height={28}
                            src={service.logo}
                            width={28}
                          />
                        ) : (
                          <Icon className="size-5" />
                        )}
                      </div>
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-black">{service.shortName}</p>
                          <p className="font-bold text-[#344054]">
                            {service.name}
                          </p>
                          <span className="rounded-full bg-[#f2f4f7] px-2 py-0.5 text-xs font-bold text-[#667085]">
                            {service.category}
                          </span>
                        </div>
                        <p className="mt-1 truncate text-sm font-medium text-[#667085]">
                          {service.description}
                        </p>
                      </div>
                      <ArrowRight
                        className={
                          isSelected
                            ? "size-4 text-[#2563eb]"
                            : "size-4 text-[#98a2b3]"
                        }
                      />
                    </a>
                  );
                })
              ) : (
                <div className="grid place-items-center px-6 py-14 text-center">
                  <p className="text-lg font-black">No services found</p>
                  <p className="mt-2 max-w-sm text-sm font-medium text-[#667085]">
                    Try searching by abbreviation, category, or common terms
                    like bucket, Redis, firewall, or Kubernetes.
                  </p>
                </div>
              )}
            </div>
          </div>
        </div>,
          document.body,
        )
        : null}
    </>
  );
}
