import { serviceLogos } from "@/lib/service-logos";

export type ServiceCategory =
  | "Compute"
  | "Containers"
  | "Storage"
  | "Networking"
  | "Databases"
  | "Security"
  | "Billing"
  | "Monitoring";

export type ServiceCatalogItem = {
  name: string;
  shortName: string;
  description: string;
  href?: string;
  logo?: string;
  status?: string;
};

export const serviceCatalog: Record<ServiceCategory, ServiceCatalogItem[]> = {
  Compute: [
    {
      name: "Elastic Cloud Server",
      shortName: "ECS",
      description: "Virtual machines with flexible compute, images, disks, and networking.",
      href: "/services/ecs",
      logo: serviceLogos.ECS,
      status: "Available",
    },
    {
      name: "Bare Metal Server",
      shortName: "BMS",
      description: "Dedicated physical servers for high performance and isolation.",
      logo: serviceLogos.BMS,
      status: "Catalog",
    },
    {
      name: "Dedicated Host",
      shortName: "DeH",
      description: "Dedicated physical hosts for ECS placement and compliance needs.",
      logo: serviceLogos.DEH,
      status: "Catalog",
    },
    {
      name: "Auto Scaling",
      shortName: "AS",
      description: "Automatically scale ECS capacity based on metrics or schedules.",
      href: "/services/as",
      logo: serviceLogos.AS,
      status: "Available",
    },
    {
      name: "Image Management Service",
      shortName: "IMS",
      description: "Create, manage, and share system and private images.",
      logo: serviceLogos.IMS,
      status: "Catalog",
    },
    {
      name: "Cloud Phone Host",
      shortName: "CPH",
      description: "Cloud-hosted mobile device resources for mobile apps and testing.",
      logo: serviceLogos.CPH,
      status: "Catalog",
    },
  ],
  Containers: [
    {
      name: "Cloud Container Engine",
      shortName: "CCE",
      description: "Managed Kubernetes clusters for containerized applications.",
      href: "/services/cce",
      logo: serviceLogos.CCE,
      status: "Available",
    },
    {
      name: "Software Repository for Container",
      shortName: "SWR",
      description: "Container image repositories, tags, scans, and pull access.",
      href: "/services/swr",
      logo: serviceLogos.SWR,
      status: "Available",
    },
    {
      name: "Cloud Container Instance",
      shortName: "CCI",
      description: "Serverless container runtime without cluster management.",
      logo: serviceLogos.CCI,
      status: "Catalog",
    },
    {
      name: "Application Service Mesh",
      shortName: "ASM",
      description: "Service mesh traffic governance and observability for microservices.",
      status: "Catalog",
    },
  ],
  Storage: [
    {
      name: "Object Storage Service",
      shortName: "OBS",
      description: "Object buckets for files, backups, static assets, and data lakes.",
      href: "/services/obs",
      logo: serviceLogos.OBS,
      status: "Available",
    },
    {
      name: "Elastic Volume Service",
      shortName: "EVS",
      description: "Block storage disks for ECS, databases, and stateful workloads.",
      href: "/services/evs",
      logo: serviceLogos.EVS,
      status: "Available",
    },
    {
      name: "Scalable File Service",
      shortName: "SFS",
      description: "Shared file storage for multiple cloud servers and containers.",
      logo: serviceLogos.SFS,
      status: "Catalog",
    },
    {
      name: "Cloud Backup and Recovery",
      shortName: "CBR",
      description: "Backup and restore for servers, disks, file systems, and apps.",
      logo: serviceLogos.CBR,
      status: "Catalog",
    },
    {
      name: "Data Express Service",
      shortName: "DES",
      description: "Offline migration service for large-scale data transfer.",
      logo: serviceLogos.DES,
      status: "Catalog",
    },
  ],
  Networking: [
    {
      name: "Virtual Private Cloud",
      shortName: "VPC",
      description: "Isolated private networks, subnets, routes, and security groups.",
      href: "/services/network",
      logo: serviceLogos.VPC,
      status: "Available",
    },
    {
      name: "Elastic IP",
      shortName: "EIP",
      description: "Public IP addresses and bandwidth for internet-facing resources.",
      href: "/services/network",
      logo: serviceLogos.EIP,
      status: "Available",
    },
    {
      name: "Elastic Load Balance",
      shortName: "ELB",
      description: "Traffic distribution across ECS, CCE, and private backend pools.",
      href: "/services/elb",
      logo: serviceLogos.ELB,
      status: "Available",
    },
    {
      name: "NAT Gateway",
      shortName: "NAT",
      description: "SNAT and DNAT connectivity for private subnet resources.",
      href: "/services/network",
      logo: serviceLogos.NAT,
      status: "Catalog",
    },
    {
      name: "Direct Connect",
      shortName: "DC",
      description: "Dedicated private connectivity between on-premises and Huawei Cloud.",
      logo: serviceLogos.DC,
      status: "Catalog",
    },
    {
      name: "Virtual Private Network",
      shortName: "VPN",
      description: "Encrypted site-to-site connectivity for VPCs and remote networks.",
      href: "/services/network",
      logo: serviceLogos.VPN,
      status: "Catalog",
    },
    {
      name: "VPC Endpoint",
      shortName: "VPCEP",
      description: "Private access to cloud services without internet exposure.",
      logo: serviceLogos.VPCEP,
      status: "Catalog",
    },
    {
      name: "Cloud Connect",
      shortName: "CC",
      description: "Global private network connectivity across regions and VPCs.",
      logo: serviceLogos.CC,
      status: "Catalog",
    },
    {
      name: "Domain Name Service",
      shortName: "DNS",
      description: "Public and private DNS zones and record management.",
      logo: serviceLogos.DNS,
      status: "Catalog",
    },
  ],
  Databases: [
    {
      name: "Relational Database Service",
      shortName: "RDS",
      description: "Managed MySQL, PostgreSQL, and SQL Server databases.",
      href: "/services/rds",
      logo: serviceLogos.RDS,
      status: "Available",
    },
    {
      name: "GaussDB",
      shortName: "GaussDB",
      description: "Enterprise distributed relational database service.",
      logo: serviceLogos.GAUSSDB,
      status: "Catalog",
    },
    {
      name: "Document Database Service",
      shortName: "DDS",
      description: "MongoDB-compatible document database service.",
      logo: serviceLogos.DDS,
      status: "Catalog",
    },
    {
      name: "Distributed Cache Service",
      shortName: "DCS",
      description: "Managed Redis and Memcached cache instances.",
      logo: serviceLogos.DCS,
      status: "Catalog",
    },
    {
      name: "Data Replication Service",
      shortName: "DRS",
      description: "Database migration, synchronization, and disaster recovery.",
      logo: serviceLogos.DRS,
      status: "Catalog",
    },
    {
      name: "Data Warehouse Service",
      shortName: "DWS",
      description: "Cloud data warehouse for analytics workloads.",
      logo: serviceLogos.DWS,
      status: "Catalog",
    },
  ],
  Security: [
    {
      name: "Identity and Access Management",
      shortName: "IAM",
      description: "Users, groups, policies, roles, and access keys.",
      logo: serviceLogos.IAM,
      status: "Catalog",
    },
    {
      name: "Web Application Firewall",
      shortName: "WAF",
      description: "Protection for websites and APIs against common web attacks.",
      logo: serviceLogos.WAF,
      status: "Catalog",
    },
    {
      name: "Data Encryption Workshop",
      shortName: "DEW",
      description: "Key management, secrets, and encryption capabilities.",
      logo: serviceLogos.DEW,
      status: "Catalog",
    },
    {
      name: "Cloud Firewall",
      shortName: "CFW",
      description: "Centralized traffic protection and access control.",
      logo: serviceLogos.CFW,
      status: "Catalog",
    },
    {
      name: "Host Security Service",
      shortName: "HSS",
      description: "Server workload protection and host intrusion detection.",
      logo: serviceLogos.HSS,
      status: "Catalog",
    },
    {
      name: "Anti-DDoS",
      shortName: "AAD",
      description: "DDoS mitigation for public network services.",
      logo: serviceLogos.AAD,
      status: "Catalog",
    },
  ],
  Billing: [
    {
      name: "Billing Center",
      shortName: "Billing",
      description: "Bills, invoices, orders, renewals, and payment management.",
      status: "Catalog",
    },
    {
      name: "Cost Center",
      shortName: "Cost",
      description: "Cost analysis, budgets, forecasts, and allocation tags.",
      status: "Catalog",
    },
    {
      name: "Resource Packages",
      shortName: "Packages",
      description: "Prepaid resource packages and usage coverage.",
      status: "Catalog",
    },
    {
      name: "Enterprise Project Management",
      shortName: "EPS",
      description: "Project-level resource grouping, accounting, and access control.",
      status: "Catalog",
    },
  ],
  Monitoring: [
    {
      name: "Cloud Eye",
      shortName: "CES",
      description: "Metrics, alarms, dashboards, and resource monitoring.",
      logo: serviceLogos.CES,
      status: "Catalog",
    },
    {
      name: "Log Tank Service",
      shortName: "LTS",
      description: "Centralized log collection, search, analysis, and retention.",
      logo: serviceLogos.LTS,
      status: "Catalog",
    },
    {
      name: "Application Operations Management",
      shortName: "AOM",
      description: "Application monitoring, alarms, topology, and operations.",
      logo: serviceLogos.AOM,
      status: "Catalog",
    },
    {
      name: "Cloud Trace Service",
      shortName: "CTS",
      description: "Audit trail of cloud API and console operations.",
      logo: serviceLogos.CTS,
      status: "Catalog",
    },
  ],
};
