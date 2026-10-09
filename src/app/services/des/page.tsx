import type { Metadata } from "next";
import { Boxes } from "lucide-react";
import Link from "next/link";
import { ConsoleShell } from "@/components/console-shell";
import { ConsoleMain, ConsolePageHeader, ConsolePanel, StatusBadge } from "@/components/console-ui";

export const metadata: Metadata = { title: "Data Express Service | Huawei Cloud Better UI" };
const documentation = "https://support.huaweicloud.com/intl/en-us/usermanual-des/";

export default function DesPage() {
  return <ConsoleShell active="Storage"><ConsoleMain>
    <ConsolePageHeader backHref="/services/storage" backLabel="Back to Storage" title="Data Express Service" icon={Boxes} description="Move large datasets to OBS by shipping disks or a Huawei Teleport device to a data center." actions={<a className="inline-flex rounded-lg bg-[#2563eb] px-4 py-3 text-sm font-bold text-white" href="https://console-intl.huaweicloud.com/" target="_blank" rel="noopener noreferrer">Open Huawei console</a>} />
    <ConsolePanel title="Order management"><div className="grid gap-4 p-5 text-sm leading-6">
      <div><StatusBadge tone="warn">Managed in Huawei console</StatusBadge><p className="mt-3">BetterUI does not currently list or change DES orders. In Huawei console, choose Service List → Storage → Data Express Service, then select the appropriate data center and region.</p></div>
      <p>Create an order with <strong>Buy DES</strong>. Review the destination bucket, import directory, duplicate-file behavior, return address, delivery requirements, and charges before purchasing. Disk orders support up to 12 disks, with one partition per disk.</p>
      <p>Expand an order to inspect transmission settings, mailing information, and processing progress. Use its <strong>More</strong> menu to modify, cancel, or delete an eligible order.</p>
      <a className="font-bold text-[#2563eb]" href={`${documentation}des_01_0047.html`} target="_blank" rel="noopener noreferrer">Disk order creation and delivery requirements</a>
      <a className="font-bold text-[#2563eb]" href={`${documentation}en-us_topic_0047663841.html`} target="_blank" rel="noopener noreferrer">Order details, modification, cancellation, and deletion</a>
    </div></ConsolePanel>
    <ConsolePanel title="When an order can be changed"><div className="grid gap-4 p-5 text-sm leading-6">
      <p><strong>Disk:</strong> Modify an order while its disk is awaiting shipment or transmission has failed. Cancel before sending the disk. Delete orders awaiting disk shipment, canceled orders, or expired orders.</p>
      <p><strong>Teleport:</strong> Modify orders under review. Cancel while under review, preparing the device, or awaiting device shipment. Delete orders under review or already canceled.</p>
      <p>Order cancellation and deletion are separate actions. Confirm the latest order status and delivery state in Huawei console before acting.</p>
    </div></ConsolePanel>
    <ConsolePanel title="Destination storage and costs"><div className="grid gap-4 p-5 text-sm leading-6">
      <p>DES charges depend on the order and processing duration. Delivery charges and subsequent OBS storage and request charges also apply. Confirm current prices and your account balance before ordering.</p>
      <div className="flex flex-wrap gap-4"><Link className="font-bold text-[#2563eb]" href="/services/obs">Manage destination OBS buckets</Link><Link className="font-bold text-[#2563eb]" href="/services/billing/center">Open Billing Center</Link><a className="font-bold text-[#2563eb]" href="https://support.huaweicloud.com/intl/en-us/productdesc-des/des_01_0072.html" target="_blank" rel="noopener noreferrer">DES billing guide</a></div>
    </div></ConsolePanel>
  </ConsoleMain></ConsoleShell>;
}
