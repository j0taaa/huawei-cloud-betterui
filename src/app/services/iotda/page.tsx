import { cloudCacheKeys } from "@/lib/huawei/cache-keys";
import type { Metadata } from "next";
import { RadioTower } from "lucide-react";

import {
  InventoryStatus,
  ServiceInventoryPage,
  type InventoryColumn,
} from "@/app/services/_components/service-inventory";
import {
  listIotdaDevices,
  type IotdaDevice,
  withCloudResult,
} from "@/lib/huawei-cloud";

export const metadata: Metadata = {
  title: "IoTDA | Huawei Cloud Better UI",
};

function statusTone(status: string): "bad" | "good" | "neutral" | "warn" {
  const normalized = status.toLowerCase();
  if (normalized === "online") return "good";
  if (["abnormal", "frozen"].includes(normalized)) return "bad";
  if (normalized === "inactive") return "warn";
  return "neutral";
}

const columns: InventoryColumn<IotdaDevice>[] = [
  {
    header: "Device",
    render: (device) => (
      <div>
        <p className="font-black">{device.deviceName}</p>
        <p className="mt-1 break-all text-xs text-[#98a2b3]">{device.deviceId}</p>
      </div>
    ),
  },
  { header: "Status", render: (device) => <InventoryStatus tone={statusTone(device.status)}>{device.status}</InventoryStatus> },
  { header: "Node", render: (device) => `${device.nodeType} / ${device.nodeId}` },
  { header: "Product", render: (device) => device.productId },
  { header: "Gateway", render: (device) => device.gatewayId },
  { header: "App", render: (device) => device.appName },
  { header: "Tags", render: (device) => device.tags },
];

export default async function IotdaPage() {
  const result = await withCloudResult<IotdaDevice[]>([], listIotdaDevices, cloudCacheKeys.listIotdaDevices);
  const devices = result.data;
  const online = devices.filter((device) => device.status.toLowerCase() === "online").length;
  const products = new Set(devices.map((device) => device.productId).filter((product) => product !== "-"));

  return (
    <ServiceInventoryPage
      actionLabel="Register device"
      actionTitle="Device registration is disabled in this read-only view."
      active="Monitoring"
      backHref="/services"
      backLabel="Back to services"
      columns={columns}
      description="Device registry status, product mapping, gateway relationship, app space, node identity, and tags."
      empty="No IoTDA devices were returned for the selected projects."
      icon={RadioTower}
      result={result}
      rows={devices}
      stats={[
        { label: "Devices", value: devices.length },
        { label: "Online", value: online, tone: online === devices.length ? "good" : "neutral" },
        { label: "Products", value: products.size },
        { label: "Gateways", value: new Set(devices.map((device) => device.gatewayId).filter((gateway) => gateway !== "-")).size },
      ]}
      tableTitle="Device inventory"
      title="IoTDA"
    />
  );
}
