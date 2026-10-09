"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { ConsoleActionButton, ConsoleActionFeedback, ConsoleActionStack } from "@/components/console-ui";

type GeminiDbAction = "restart";

const actionMeta = {
  restart: {
    label: "Restart",
    prompt:
      "Restart this GeminiDB instance now? The database will be unavailable while the restart runs.",
  },
} as const;

function canRestart(status: string) {
  return status.toLowerCase() === "normal";
}

export function GeminiDbInstanceActions({
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
  const [pending, setPending] = useState<GeminiDbAction | null>(null);
  const [message, setMessage] = useState("");
  const disabled = !canRestart(status);

  async function runAction(action: GeminiDbAction) {
    if (disabled) {
      setMessage("Restart is available only when the GeminiDB status is normal.");
      return;
    }

    if (!window.confirm(actionMeta[action].prompt)) {
      return;
    }

    setPending(action);
    setMessage("");

    const response = await fetch(`/api/cloud/geminidb/${id}/action`, {
      body: JSON.stringify({ action, projectId }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      jobId?: string | null;
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
            ? "Restart is available only when the GeminiDB instance status is normal."
            : "Restart this GeminiDB instance."
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
