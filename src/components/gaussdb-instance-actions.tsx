"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { ConsoleActionButton, ConsoleActionFeedback, ConsoleActionStack } from "@/components/console-ui";

type GaussDbAction = "reboot";

const actionMeta = {
  reboot: {
    label: "Reboot",
    prompt:
      "Reboot this GaussDB instance now? The database will be unavailable while the reboot runs.",
  },
} as const;

function canReboot(status: string) {
  return ["available", "normal", "active", "running"].includes(
    status.toLowerCase(),
  );
}

export function GaussDbInstanceActions({
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
  const [pending, setPending] = useState<GaussDbAction | null>(null);
  const [message, setMessage] = useState("");
  const disabled = !canReboot(status);

  async function runAction(action: GaussDbAction) {
    if (disabled) {
      setMessage("Reboot is available only when the GaussDB instance is healthy.");
      return;
    }

    if (!window.confirm(actionMeta[action].prompt)) {
      return;
    }

    setPending(action);
    setMessage("");

    const response = await fetch(`/api/cloud/gaussdb/${id}/action`, {
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
        tone={variant === "hero" ? "success" : "neutral"}
        title={
          disabled
            ? "Reboot is available only when the GaussDB instance is healthy."
            : "Reboot this GaussDB instance."
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
