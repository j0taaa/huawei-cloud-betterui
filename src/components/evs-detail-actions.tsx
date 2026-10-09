"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { DatabaseBackup, Download, Loader2 } from "lucide-react";

import {
  ConsoleButton,
  ConsoleCallout,
  ConsoleDescriptionList,
  ConsoleField,
  ConsoleInput,
  ConsoleModal,
  ConsoleModalActions,
  ConsoleModalBody,
  ConsoleModalMessage,
  ConsoleSelect,
  ConsoleTextarea,
} from "@/components/console-ui";

type EvsBackupVault = {
  id: string;
  name: string;
  policyNames: string[];
  projectId: string;
  status: string;
};

type EvsSnapshotExportRow = {
  createdAt: string;
  description: string;
  id: string;
  name: string;
  projectName: string;
  region: string;
  size: string;
  status: string;
};

function csvCell(value: string) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function ExportEvsSnapshotsButton({
  fileName = "evs-snapshots.csv",
  snapshots,
}: {
  fileName?: string;
  snapshots: EvsSnapshotExportRow[];
}) {
  function download() {
    const headers = ["Name", "ID", "Status", "Size", "Created", "Project", "Region", "Description"];
    const rows = snapshots.map((snapshot) => [
      snapshot.name,
      snapshot.id,
      snapshot.status,
      snapshot.size,
      snapshot.createdAt,
      snapshot.projectName,
      snapshot.region,
      snapshot.description,
    ]);
    const csv = [headers, ...rows]
      .map((row) => row.map((value) => csvCell(String(value))).join(","))
      .join("\r\n");
    const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    URL.revokeObjectURL(url);
  }

  return (
    <ConsoleButton disabled={!snapshots.length} onClick={download} size="md" variant="neutral">
      <Download className="size-4" />
      Export CSV
    </ConsoleButton>
  );
}

export function CreateEvsBackupButton({
  disk,
  vaults,
}: {
  disk: { id: string; name: string; projectId: string; size: string };
  vaults: EvsBackupVault[];
}) {
  const router = useRouter();
  const [description, setDescription] = useState("");
  const [failed, setFailed] = useState(false);
  const [message, setMessage] = useState("");
  const [name, setName] = useState(
    `${disk.name}-backup`.replace(/[^\p{L}\p{N}_-]+/gu, "-").slice(0, 64),
  );
  const [open, setOpen] = useState(false);
  const [pending, setPending] = useState(false);
  const [vaultId, setVaultId] = useState(vaults[0]?.id ?? "");
  const selectedVault = vaults.find((vault) => vault.id === vaultId);
  const canSubmit = Boolean(
    selectedVault &&
    ["available", "error"].includes(selectedVault.status.toLowerCase()) &&
    /^[\p{L}\p{N}_-]{1,64}$/u.test(name.trim()) &&
    description.length <= 255 &&
    !/[<>]/.test(description),
  );

  async function submit() {
    if (!canSubmit || !selectedVault) return;

    setPending(true);
    setFailed(false);
    setMessage("");
    const response = await fetch(`/api/cloud/evs/disks/${encodeURIComponent(disk.id)}/backup`, {
      body: JSON.stringify({
        description,
        name: name.trim(),
        projectId: disk.projectId,
        vaultId: selectedVault.id,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      checkpointId?: string | null;
      error?: string;
    };

    setMessage(
      response.ok
        ? result.checkpointId
          ? `Backup submitted: ${result.checkpointId}`
          : "Backup submitted."
        : result.error ?? "Backup creation failed.",
    );
    setFailed(!response.ok);
    setPending(false);
    if (response.ok) router.refresh();
  }

  return (
    <>
      <ConsoleButton
        disabled={!vaults.length}
        onClick={() => {
          setMessage("");
          setFailed(false);
          setOpen(true);
        }}
        size="md"
        title={vaults.length ? "Create a CBR backup" : "Associate this disk with a CBR disk backup vault first."}
        variant="purple"
      >
        <DatabaseBackup className="size-4" />
        Create backup
      </ConsoleButton>

      {open ? (
        <ConsoleModal
          description={<>Create an incremental CBR restore point for {disk.name}.</>}
          footer={(
            <ConsoleModalActions>
              <ConsoleButton onClick={() => setOpen(false)} size="md" variant="neutral">Cancel</ConsoleButton>
              <ConsoleButton disabled={pending || !canSubmit} onClick={submit} size="md" variant="purple">
                {pending ? <Loader2 className="size-4 animate-spin" /> : <DatabaseBackup className="size-4" />}
                Create backup
              </ConsoleButton>
            </ConsoleModalActions>
          )}
          onClose={() => setOpen(false)}
          title="Create EVS backup"
        >
          <ConsoleModalBody>
            <ConsoleCallout tone="info">
              The disk must remain associated with the selected vault while the checkpoint is created.
            </ConsoleCallout>
            <ConsoleDescriptionList
              items={[
                { label: "Disk", value: disk.name },
                { label: "Capacity", value: disk.size },
              ]}
            />
            <ConsoleField label="Backup vault">
              <ConsoleSelect onChange={(event) => setVaultId(event.target.value)} value={vaultId}>
                {vaults.map((vault) => (
                  <option key={vault.id} value={vault.id}>{vault.name} · {vault.status}</option>
                ))}
              </ConsoleSelect>
            </ConsoleField>
            <ConsoleField label="Backup name">
              <ConsoleInput maxLength={64} onChange={(event) => setName(event.target.value)} value={name} />
            </ConsoleField>
            <ConsoleField label="Description">
              <ConsoleTextarea maxLength={255} onChange={(event) => setDescription(event.target.value)} value={description} />
            </ConsoleField>
            {selectedVault?.policyNames.length ? (
              <ConsoleCallout tone="info">
                Attached policies: {selectedVault.policyNames.join(", ")}.
              </ConsoleCallout>
            ) : null}
          </ConsoleModalBody>
          {message ? <ConsoleModalMessage tone={failed ? "danger" : "success"}>{message}</ConsoleModalMessage> : null}
        </ConsoleModal>
      ) : null}
    </>
  );
}
