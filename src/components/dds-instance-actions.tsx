"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { ConsoleActionButton, ConsoleActionFeedback, ConsoleActionStack } from "@/components/console-ui";

type DdsAction = "restart";

const actionMeta = {
  restart: {
    label: "Restart",
    prompt:
      "Restart this DDS instance now? The database will be unavailable while the restart runs.",
  },
} as const;

function canRestart(status: string) {
  return ["normal", "available", "active", "running"].includes(
    status.toLowerCase(),
  );
}

export function DdsInstanceActions({
  id,
  projectId,
  status,
  variant = "default",
}: {
  id: string;
  projectId?: string;
  status: string;
  variant?: "default" | "hero";
}) {
  const router = useRouter();
  const [pending, setPending] = useState<DdsAction | null>(null);
  const [message, setMessage] = useState("");
  const disabled = !canRestart(status);

  async function runAction(action: DdsAction) {
    if (disabled) {
      setMessage("Restart is available only when the instance is healthy.");
      return;
    }

    if (!window.confirm(actionMeta[action].prompt)) {
      return;
    }

    setPending(action);
    setMessage("");

    const response = await fetch(`/api/cloud/dds/${id}/action`, {
      body: JSON.stringify({ action, projectId }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      jobId?: string;
    };

    if (!response.ok) {
      setMessage(result.error ?? "Action failed.");
      setPending(null);
      return;
    }

    setMessage(
      result.jobId ? `Job submitted: ${result.jobId}` : "Action submitted.",
    );
    setPending(null);
    router.refresh();
  }

  return (
    <ConsoleActionStack>
      <ConsoleActionButton
        disabled={disabled || !!pending}
        onClick={() => runAction("restart")}
        prominence={variant}
        tone={variant === "hero" ? "primary" : "neutral"}
        title={
          disabled
            ? "Restart is available only when the DDS instance is healthy."
            : "Restart this DDS instance."
        }
      >
        {pending === "restart" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCw className="size-4" />
        )}
        {actionMeta.restart.label}
      </ConsoleActionButton>
      {message ? <ConsoleActionFeedback>{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
  );
}
