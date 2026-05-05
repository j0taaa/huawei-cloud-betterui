import {
  Activity,
  Cloud,
  CreditCard,
  Database,
  Gauge,
  Globe2,
  HardDrive,
  LockKeyhole,
  Network,
  Server,
  ShieldCheck,
  Zap,
} from "lucide-react";

export const navigationItems = [
  "Overview",
  "Services",
  "Resources",
  "Billing",
  "Support",
  "Settings",
];

export const serviceCategories = [
  {
    name: "Compute",
    description: "Elastic Cloud Server, bare metal, auto scaling, and container workloads.",
    icon: Server,
    status: "12 active",
  },
  {
    name: "Storage",
    description: "Object, block, file, backup, and archival storage in one fast console.",
    icon: HardDrive,
    status: "8 buckets",
  },
  {
    name: "Databases",
    description: "RDS, GaussDB, Redis, and distributed database monitoring.",
    icon: Database,
    status: "5 instances",
  },
  {
    name: "Networking",
    description: "VPC, Elastic IP, load balancing, DNS, CDN, and private links.",
    icon: Network,
    status: "3 regions",
  },
  {
    name: "Security",
    description: "IAM, key management, cloud firewall, audit logs, and posture checks.",
    icon: ShieldCheck,
    status: "97% score",
  },
  {
    name: "Observability",
    description: "Metrics, traces, alarms, logs, events, and incident workflows.",
    icon: Activity,
    status: "24 alerts",
  },
];

export const dashboardMetrics = [
  {
    label: "Monthly spend",
    value: "$18,420",
    detail: "7.4% under forecast",
    icon: CreditCard,
  },
  {
    label: "Cache hit rate",
    value: "94.8%",
    detail: "Global console data",
    icon: Zap,
  },
  {
    label: "Healthy resources",
    value: "218",
    detail: "Across 3 regions",
    icon: Gauge,
  },
  {
    label: "Public endpoints",
    value: "42",
    detail: "9 protected by WAF",
    icon: Globe2,
  },
];

export const recentResources = [
  {
    name: "ecs-prod-api-01",
    type: "Elastic Cloud Server",
    region: "SA-Brazil-1",
    state: "Running",
  },
  {
    name: "obs-customer-exports",
    type: "Object Storage Service",
    region: "LA-Santiago",
    state: "Healthy",
  },
  {
    name: "vpc-commerce-core",
    type: "Virtual Private Cloud",
    region: "SA-Brazil-1",
    state: "Review",
  },
  {
    name: "rds-orders-primary",
    type: "Relational Database Service",
    region: "LA-Mexico City",
    state: "Scaling",
  },
];

export const roadmapItems = [
  {
    title: "API integration layer",
    description: "Centralized Huawei Cloud SDK clients, request dedupe, and route handlers.",
    icon: Cloud,
  },
  {
    title: "Smart cache",
    description: "Stale-while-revalidate resource views with optimistic console updates.",
    icon: Zap,
  },
  {
    title: "Access model",
    description: "IAM-aware navigation, scoped actions, and audit-friendly workflows.",
    icon: LockKeyhole,
  },
];
