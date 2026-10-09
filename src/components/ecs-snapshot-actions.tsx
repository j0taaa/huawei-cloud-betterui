"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Camera, Loader2, Trash2 } from "lucide-react";

import { ConsoleActionFeedback, ConsoleActionStack, ConsoleButton } from "@/components/console-ui";

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
    <ConsoleActionStack>
      <ConsoleButton
        disabled={pending || targets.length === 0}
        onClick={createSnapshot}
        size="md"
      >
        {pending ? <Loader2 className="size-4 animate-spin" /> : <Camera className="size-4" />}
        Create snapshot
      </ConsoleButton>
      {message ? <ConsoleActionFeedback>{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
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
      <ConsoleButton
        className="text-xs font-black"
        disabled={pending}
        onClick={deleteSnapshot}
        size="sm"
        variant="dangerOutline"
      >
        {pending ? <Loader2 className="size-3.5 animate-spin" /> : <Trash2 className="size-3.5" />}
        Delete
      </ConsoleButton>
      {message ? <p className="text-xs font-bold text-[#2563eb]">{message}</p> : null}
    </div>
  );
}
