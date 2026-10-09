"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { ConsoleActionButton, ConsoleActionFeedback, ConsoleActionStack } from "@/components/console-ui";

type RdsAction = "reboot";

const actionMeta = {
  reboot: {
    label: "Reboot",
    prompt:
      "Reboot this RDS instance now? The database will be unavailable while the reboot runs.",
  },
} as const;

function canReboot(status: string) {
  return ["active", "available", "normal", "running"].includes(
    status.toLowerCase(),
  );
}

export function RdsInstanceActions({
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
  const [pending, setPending] = useState<RdsAction | null>(null);
  const [message, setMessage] = useState("");
  const disabled = !canReboot(status);

  async function runAction(action: RdsAction) {
    if (disabled) {
      setMessage("Reboot is available only when the instance is healthy.");
      return;
    }

    if (!window.confirm(actionMeta[action].prompt)) {
      return;
    }

    setPending(action);
    setMessage("");

    const response = await fetch(`/api/cloud/rds/${id}/action`, {
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
        onClick={() => runAction("reboot")}
        prominence={variant}
        tone={variant === "hero" ? "primary" : "neutral"}
        title={
          disabled
            ? "Reboot is available only when the RDS instance is healthy."
            : "Reboot this RDS instance."
        }
      >
        {pending === "reboot" ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCw className="size-4" />
        )}
        {actionMeta.reboot.label}
      </ConsoleActionButton>
      {message ? <ConsoleActionFeedback>{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
  );
}
