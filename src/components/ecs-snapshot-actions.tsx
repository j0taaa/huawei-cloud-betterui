"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";

type SnapshotTarget = {
  diskId: string;
  label: string;
};

export function CreateSnapshotButton({
  ecsId,
  projectId,
  targets,
}: {
  ecsId: string;
  projectId: string;
  targets: SnapshotTarget[];
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function createSnapshot() {
    const selectedDiskId =
      targets.length > 1
        ? window.prompt(
            `Choose disk id to snapshot:\n\n${targets
              .map((item) => `${item.diskId} - ${item.label}`)
              .join("\n")}`,
            targets[0]?.diskId,
          )
        : targets[0]?.diskId;
    const target = targets.find((item) => item.diskId === selectedDiskId);

    if (!target) {
      setMessage("No attached disk was selected for snapshot creation.");
      return;
    }

    const defaultName = `snap-${ecsId.slice(0, 8)}-${new Date()
      .toISOString()
      .slice(0, 16)
      .replace(/[-:T]/g, "")}`;
    const name = window.prompt(
      `Create snapshot for ${target.label}?\n\nSnapshot name:`,
      defaultName,
    );

    if (!name) {
      return;
    }

    const description = window.prompt("Description (optional):", "") ?? "";
    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/evs/snapshots", {
      body: JSON.stringify({
        description,
        diskId: target.diskId,
        ecsId,
        name,
        projectId,
      }),
      headers: { "Content-Type": "application/json" },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      id?: string | null;
    };

    if (!response.ok) {
      setMessage(result.error ?? "Snapshot creation failed.");
      setPending(false);
      return;
    }

    setMessage(result.id ? `Snapshot creation started: ${result.id}` : "Snapshot creation started.");
    setPending(false);
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <button
        className="inline-flex h-10 items-center gap-2 rounded-lg border border-[#2563eb] bg-[#2563eb] px-3 text-sm font-bold text-white shadow-sm hover:bg-[#1d4ed8] disabled:opacity-70"
        disabled={pending || targets.length === 0}
        onClick={createSnapshot}
        type="button"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        Create snapshot
      </button>
      {message ? <p className="text-sm font-bold text-[#2563eb]">{message}</p> : null}
    </div>
  );
}

export function DeleteSnapshotButton({
  ecsId,
  projectId,
  snapshotId,
  snapshotName,
}: {
  ecsId: string;
  projectId: string;
  snapshotId: string;
  snapshotName: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState("");

  async function deleteSnapshot() {
    if (!window.confirm(`Delete snapshot ${snapshotName}?`)) {
      return;
    }

    setPending(true);
    setMessage("");

    const response = await fetch("/api/cloud/evs/snapshots", {
      body: JSON.stringify({ ecsId, projectId, snapshotId }),
      headers: { "Content-Type": "application/json" },
      method: "DELETE",
    });
    const result = (await response.json().catch(() => ({}))) as { error?: string };

    if (!response.ok) {
      setMessage(result.error ?? "Snapshot deletion failed.");
      setPending(false);
      return;
    }

    setMessage("Snapshot deletion started.");
    setPending(false);
    router.refresh();
  }

  return (
    <div className="grid justify-items-start gap-1">
      <button
        className="inline-flex h-9 items-center gap-2 rounded-lg border border-[#fecdd3] bg-white px-3 text-xs font-black text-[#b42318] hover:bg-[#fff1f2] disabled:opacity-70"
        disabled={pending}
        onClick={deleteSnapshot}
        type="button"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        Delete
      </button>
      {message ? <p className="text-xs font-bold text-[#2563eb]">{message}</p> : null}
    </div>
  );
}
