"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { FolderPlus, KeyRound, Loader2, Trash2 } from "lucide-react";

import {
  ConsoleButton,
  ConsoleCheckbox,
  ConsoleConfirmSummary,
  ConsoleField,
  ConsoleInput,
  ConsoleInlineMessage,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalFooterNote,
  ConsoleModalMessage,
  ConsoleSelect,
  SimpleTable,
  type SimpleTableRow,
} from "@/components/console-ui";

type ProjectOption = {
  label: string;
  value: string;
};

type SfsActionResponse = {
  access?: unknown;
  error?: string;
  id?: string | null;
  rules?: SfsAccessRule[];
};

type SfsAccessRule = {
  accessLevel: string;
  accessTo: string;
  accessType: string;
  createdAt: string;
  id: string;
  state: string;
  updatedAt: string;
};

export function CreateSfsShareButton({
  projects,
}: {
  projects: ProjectOption[];
}) {
  const router = useRouter();
  const [availabilityZone, setAvailabilityZone] = useState("");
  const [description, setDescription] = useState("");
  const [enterpriseProjectId, setEnterpriseProjectId] = useState("");
  const [isPublic, setIsPublic] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [projectId, setProjectId] = useState(projects[0]?.value ?? "");
  const [shareType, setShareType] = useState("");
  const [sizeGb, setSizeGb] = useState("1");
  const validName = /^[A-Za-z0-9_-]{1,255}$/.test(name.trim());

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/sfs/shares", {
      body: JSON.stringify({
        availabilityZone,
        description,
        enterpriseProjectId,
        isPublic,
        name,
        projectId,
        shareType,
        sizeGb: Number(sizeGb),
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as SfsActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "File system creation failed.");
      setPending(false);
      return;
    }

    setMessage(result.id ? `Creation accepted: ${result.id}` : "Creation accepted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        onClick={() => {
          setMessage("");
          setOpen(true);
        }}
        size="lg"
        variant="success"
      >
        <FolderPlus className="size-4" />
        Create file system
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Creates an NFS capacity-oriented share. Add ACL rules after it becomes available."
          footer={(
            <>
              <ConsoleModalFooterNote>
                Protocol is fixed to NFS to match Huawei SFS capacity-oriented support.
              </ConsoleModalFooterNote>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !validName || Number(sizeGb) < 1}
                  onClick={submit}
                  size="md"
                  variant="success"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <FolderPlus className="size-4" />}
                  Create
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          maxWidthClassName="max-w-3xl"
          onClose={() => setOpen(false)}
          panelClassName="border-[#bbf7d0]"
          title="Create SFS file system"
        >
            <ConsoleModalBody className="md:grid-cols-2">
              <ConsoleField label="Name">
                <ConsoleInput
                  focusTone="success"
                  onChange={(event) => setName(event.target.value)}
                  placeholder="shared_logs"
                  value={name}
                />
              </ConsoleField>
              <ConsoleField label="Size GiB">
                <ConsoleInput
                  focusTone="success"
                  min={1}
                  onChange={(event) => setSizeGb(event.target.value)}
                  type="number"
                  value={sizeGb}
                />
              </ConsoleField>
              <ConsoleField label="Project">
                <ConsoleSelect
                  focusTone="success"
                  onChange={(event) => setProjectId(event.target.value)}
                  value={projectId}
                >
                  {projects.map((project) => (
                    <option key={project.value || "current"} value={project.value}>
                      {project.label}
                    </option>
                  ))}
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleField label="Availability zone">
                <ConsoleInput
                  focusTone="success"
                  onChange={(event) => setAvailabilityZone(event.target.value)}
                  placeholder="Optional"
                  value={availabilityZone}
                />
              </ConsoleField>
              <ConsoleField label="Share type ID">
                <ConsoleInput
                  focusTone="success"
                  onChange={(event) => setShareType(event.target.value)}
                  placeholder="Optional"
                  value={shareType}
                />
              </ConsoleField>
              <ConsoleField label="Enterprise project ID">
                <ConsoleInput
                  focusTone="success"
                  onChange={(event) => setEnterpriseProjectId(event.target.value)}
                  placeholder="Optional"
                  value={enterpriseProjectId}
                />
              </ConsoleField>
              <ConsoleField className="md:col-span-2" label="Description">
                <ConsoleInput
                  focusTone="success"
                  maxLength={255}
                  onChange={(event) => setDescription(event.target.value)}
                  placeholder="Optional, letters digits hyphens underscores"
                  value={description}
                />
              </ConsoleField>
              <ConsoleCheckbox
                checked={isPublic}
                className="md:col-span-2"
                label="Publicly visible share"
                onChange={(event) => setIsPublic(event.target.checked)}
              />
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="success">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function DeleteSfsShareButton({
  projectId,
  shareId,
  shareName,
  status,
}: {
  projectId: string;
  shareId: string;
  shareName: string;
  status: string;
}) {
  const router = useRouter();
  const [confirmName, setConfirmName] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const confirmationMatches = useMemo(
    () => confirmName.trim() === shareName,
    [confirmName, shareName],
  );
  const canDelete = ["available", "unavailable", "error"].includes(
    status.toLowerCase(),
  );

  async function submit() {
    setPending(true);
    setMessage("");

    const response = await fetch(`/api/cloud/sfs/shares/${encodeURIComponent(shareId)}`, {
      body: JSON.stringify({ confirmName, projectId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const result = (await response.json().catch(() => ({}))) as SfsActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "File system deletion failed.");
      setPending(false);
      return;
    }

    setMessage("Deletion accepted.");
    setPending(false);
    router.refresh();
  }

  return (
    <>
      <ConsoleButton
        className="text-xs font-black"
        disabled={!canDelete}
        onClick={() => {
          setConfirmName("");
          setMessage("");
          setOpen(true);
        }}
        size="sm"
        title={
          canDelete
            ? "Delete file system"
            : "Only Available, Unavailable, or Creation failed file systems can be deleted."
        }
        variant="dangerOutline"
      >
        <Trash2 className="size-3.5" />
        Delete
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description="Data in this file system cannot be recovered after deletion."
          footer={(
            <>
              <p className="text-sm font-bold text-[#b42318]">Unmount clients before deleting.</p>
              <ConsoleModalActions>
                <ConsoleButton size="md" variant="neutral" onClick={() => setOpen(false)}>
                  Cancel
                </ConsoleButton>
                <ConsoleButton
                  disabled={pending || !confirmationMatches}
                  onClick={submit}
                  size="md"
                  variant="danger"
                >
                  {pending ? <Loader2 className="size-4 animate-spin" /> : <Trash2 className="size-4" />}
                  Delete
                </ConsoleButton>
              </ConsoleModalActions>
            </>
          )}
          onClose={() => setOpen(false)}
          title="Delete SFS file system"
          tone="danger"
        >
            <ConsoleModalBody>
              <ConsoleConfirmSummary>
                {shareName} · {shareId}
              </ConsoleConfirmSummary>
              <ConsoleField label="Type the file system name to confirm">
                <ConsoleInput
                  className="border-[#fda29b]"
                  focusTone="danger"
                  onChange={(event) => setConfirmName(event.target.value)}
                  value={confirmName}
                />
              </ConsoleField>
            </ConsoleModalBody>
            {message ? <ConsoleModalMessage tone="danger">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}

export function ManageSfsAclButton({
  projectId,
  shareId,
  shareName,
}: {
  projectId: string;
  shareId: string;
  shareName: string;
}) {
  const router = useRouter();
  const [accessLevel, setAccessLevel] = useState<"rw" | "ro">("rw");
  const [accessTo, setAccessTo] = useState("");
  const [message, setMessage] = useState("");
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState<string | null>(null);
  const [rules, setRules] = useState<SfsAccessRule[]>([]);

  async function loadRules() {
    setPending("load");
    setMessage("");
    const response = await fetch(
      `/api/cloud/sfs/shares/${encodeURIComponent(shareId)}/access-rules?projectId=${encodeURIComponent(projectId)}`,
    );
    const result = (await response.json().catch(() => ({}))) as SfsActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "Could not load ACL rules.");
      setPending(null);
      return;
    }

    setRules(result.rules ?? []);
    setPending(null);
  }

  async function addRule() {
    setPending("add");
    setMessage("");

    const response = await fetch(
      `/api/cloud/sfs/shares/${encodeURIComponent(shareId)}/access-rules`,
      {
        body: JSON.stringify({ accessLevel, accessTo, projectId }),
        headers: { "Content-Type": "application/json" },
        method: "POST",
      },
    );
    const result = (await response.json().catch(() => ({}))) as SfsActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "ACL rule creation failed.");
      setPending(null);
      return;
    }

    setAccessTo("");
    setMessage("ACL rule creation accepted.");
    setPending(null);
    await loadRules();
    router.refresh();
  }

  async function deleteRule(ruleId: string) {
    if (!window.confirm("Delete this SFS ACL rule?")) {
      return;
    }

    setPending(ruleId);
    setMessage("");

    const response = await fetch(
      `/api/cloud/sfs/shares/${encodeURIComponent(shareId)}/access-rules/${encodeURIComponent(ruleId)}`,
      {
        body: JSON.stringify({ projectId }),
        headers: { "Content-Type": "application/json" },
        method: "DELETE",
      },
    );
    const result = (await response.json().catch(() => ({}))) as SfsActionResponse;

    if (!response.ok) {
      setMessage(result.error ?? "ACL rule deletion failed.");
      setPending(null);
      return;
    }

    setRules((current) => current.filter((rule) => rule.id !== ruleId));
    setMessage("ACL rule deletion accepted.");
    setPending(null);
    router.refresh();
  }

  const ruleRows: SimpleTableRow[] = rules.map((rule) => ({
    key: rule.id,
    cells: [
      <span className="block max-w-96 break-all font-bold" key="target">{rule.accessTo}</span>,
      <span className="font-bold" key="type">{rule.accessType}</span>,
      <span className="font-bold" key="level">{rule.accessLevel}</span>,
      <span className="font-bold" key="state">{rule.state}</span>,
      <ConsoleButton
        disabled={pending === rule.id}
        key="actions"
        onClick={() => deleteRule(rule.id)}
        size="xs"
        variant="dangerOutline"
      >
        {pending === rule.id ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        Delete
      </ConsoleButton>,
    ],
  }));

  return (
    <>
      <ConsoleButton
        className="text-xs font-black"
        onClick={() => {
          setOpen(true);
          void loadRules();
        }}
        size="sm"
        variant="neutral"
      >
        <KeyRound className="size-3.5" />
        ACL
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>{shareName} · IP/VPC based NFS authorization</>}
          maxWidthClassName="max-w-3xl"
          onClose={() => setOpen(false)}
          panelClassName="border-[#bfdbfe]"
          title="SFS access rules"
        >
            <ConsoleModalBody className="md:grid-cols-[1fr_160px_auto]">
              <ConsoleField label="Access target">
                <ConsoleInput
                  onChange={(event) => setAccessTo(event.target.value)}
                  placeholder="vpc-id or vpc-id#10.0.0.0/24#1#all_squash,root_squash"
                  value={accessTo}
                />
              </ConsoleField>
              <ConsoleField label="Level">
                <ConsoleSelect
                  onChange={(event) => setAccessLevel(event.target.value as "rw" | "ro")}
                  value={accessLevel}
                >
                  <option value="rw">Read/write</option>
                  <option value="ro">Read only</option>
                </ConsoleSelect>
              </ConsoleField>
              <ConsoleButton
                className="mt-7"
                disabled={pending === "add" || !accessTo.trim()}
                onClick={addRule}
                size="lg"
              >
                {pending === "add" ? <Loader2 className="size-4 animate-spin" /> : <KeyRound className="size-4" />}
                Add
              </ConsoleButton>
            </ConsoleModalBody>
            <div className="border-t border-[#dbeafe] p-5">
              {pending === "load" ? (
                <ConsoleModalFooterNote>Loading rules...</ConsoleModalFooterNote>
              ) : (
                <SimpleTable
                  columns={[
                    { header: "Target", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                    { header: "Type", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                    { header: "Level", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                    { header: "State", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                    { header: "Actions", className: "px-4 py-3", headerClassName: "px-4 py-3" },
                  ]}
                  emptyState={
                    <ConsoleInlineMessage className="p-4">
                      No access rules returned. Add a VPC or VPC/IP rule before mounting clients.
                    </ConsoleInlineMessage>
                  }
                  minWidthClassName="min-w-[720px]"
                  rows={ruleRows}
                />
              )}
            </div>
            {message ? <ConsoleModalMessage tone="info">{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}
