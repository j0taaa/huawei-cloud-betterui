"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RotateCw } from "lucide-react";

import { ConsoleActionButton, ConsoleActionFeedback, ConsoleActionStack } from "@/components/console-ui";

type DmsKafkaAction = "restart";

const actionMeta = {
  restart: {
    label: "Restart",
    prompt:
      "Restart this Kafka instance now? Clients can reject produce and consume requests while the restart runs.",
  },
} as const;

function canRestart(status: string) {
  return ["running", "faulty"].includes(status.toLowerCase());
}

export function DmsKafkaInstanceActions({
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
  const [pending, setPending] = useState<DmsKafkaAction | null>(null);
  const [message, setMessage] = useState("");
  const disabled = !canRestart(status);

  async function runAction(action: DmsKafkaAction) {
    if (disabled) {
      setMessage("Restart is available only when the Kafka instance is Running or Faulty.");
      return;
    }

    if (!window.confirm(actionMeta[action].prompt)) {
      return;
    }

    setPending(action);
    setMessage("");

    const response = await fetch(`/api/cloud/dms-kafka/${id}/action`, {
      body: JSON.stringify({ action, projectId }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });
    const result = (await response.json().catch(() => ({}))) as {
      error?: string;
      result?: string;
    };

    if (!response.ok) {
      setMessage(result.error ?? "Action failed.");
      setPending(null);
      return;
    }

    setMessage(result.result ? `Action submitted: ${result.result}` : "Action submitted.");
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
            ? "Restart is available only when the Kafka instance is Running or Faulty."
            : "Restart this Kafka instance."
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
