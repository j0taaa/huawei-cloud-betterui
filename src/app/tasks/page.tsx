import Link from "next/link";
import { redirect } from "next/navigation";
import { ListTodo } from "lucide-react";
import { ConsoleShell } from "@/components/console-shell";
import { ConsoleMain, ConsolePageHeader, ConsolePanel, SimpleTable, StatusBadge } from "@/components/console-ui";
import { LocalDateTime } from "@/components/local-date-time";
import { ManagementTaskRefresh } from "@/components/management-task-refresh";
import { managementAdapters } from "@/lib/huawei/management/registry";
import { RefreshButton } from "@/components/cloud-action-buttons";
import { getCurrentSession } from "@/lib/auth-session";
import { listManagementHistory } from "@/lib/huawei/management/history";

export default async function TasksPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  const history = await listManagementHistory(session);
  return <ConsoleShell active="Dashboard"><ConsoleMain><ConsolePageHeader backHref="/" backLabel="Back to dashboard" title="Operation history" icon={ListTodo} description="The latest 100 operations submitted through BetterUI management. Submitted means Huawei accepted the request; use the service's cloud tasks or resource state to verify completion." actions={<RefreshButton />} />
    <ConsolePanel title="Recent operations"><SimpleTable columns={[{ header: "Operation" }, { header: "State" }, { header: "Resource / project" }, { header: "Cloud job" }, { header: "Started" }, { header: "Outcome" }]} emptyState="No management operations have been recorded for this account and user." rows={history.map((entry) => ({ key: entry.id, cells: [<Link key="operation" className="text-[#2563eb]" href={`/services/${entry.service}/manage`}>{entry.operation}</Link>, <StatusBadge key="state" tone={entry.state === "failed" ? "bad" : entry.state === "succeeded" ? "good" : "warn"}>{entry.state}</StatusBadge>, <div key="resource" className="text-xs leading-6">{entry.resourceName ?? entry.resourceId ?? "New resource"}<p>{entry.projectId ?? "Account-wide"}</p></div>, <div key="job" className="space-y-2 text-xs">{entry.jobId ?? "—"}{entry.state === "submitted" && entry.jobId && managementAdapters[entry.service]?.poll ? <ManagementTaskRefresh id={entry.id} /> : null}</div>, <LocalDateTime key="time" value={entry.startedAt} />, <p key="message" className="max-w-lg text-xs leading-6">{entry.message ?? (entry.state === "running" ? "Submission is in progress, or the process stopped before recording an outcome. Check cloud state before retrying." : "—")}</p>] }))} /></ConsolePanel>
  </ConsoleMain></ConsoleShell>;
}
