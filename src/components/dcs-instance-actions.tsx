"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw, RotateCw, Trash2 } from "lucide-react";

import { ConsoleActionButton, ConsoleActionFeedback, ConsoleActionStack } from "@/components/console-ui";

type DcsAction = "flush" | "restart" | "soft_restart";

const actionMeta = {
  flush: {
    icon: Trash2,
    label: "Flush data",
    prompt:
      "Type FLUSH to clear all Redis data on this DCS instance. This cannot be undone.",
  },
  restart: {
    icon: RotateCw,
    label: "Restart",
    prompt: "Restart this DCS Redis instance now?",
  },
  soft_restart: {
    icon: RefreshCw,
    label: "Soft restart",
    prompt: "Restart only the Redis process for this DCS instance now?",
  },
} as const;

function canRunAction(status: string) {
  return ["running", "normal", "available"].includes(status.toLowerCase());
}

function canFlush(engineVersion: string) {
  const major = Number(engineVersion.match(/\d+/)?.[0] ?? 0);

  return major >= 4;
}

export function DcsInstanceActions({
  engineVersion,
  id,
  projectId,
  status,
  variant = "default",
}: {
  engineVersion: string;
  id: string;
  projectId?: string;
  status: string;
  variant?: "default" | "hero";
}) {
  const router = useRouter();
  const [pending, setPending] = useState<DcsAction | null>(null);
  const [message, setMessage] = useState("");
  const healthy = canRunAction(status);
  const actions: DcsAction[] = canFlush(engineVersion)
    ? ["restart", "soft_restart", "flush"]
    : ["restart", "soft_restart"];

  async function runAction(action: DcsAction) {
    if (!healthy) {
      setMessage("Actions are available only when the DCS instance is running.");
      return;
    }

    if (action === "flush") {
      if (window.prompt(actionMeta.flush.prompt) !== "FLUSH") {
        return;
      }
    } else if (!window.confirm(actionMeta[action].prompt)) {
      return;
    }

    setPending(action);
    setMessage("");

    const response = await fetch(`/api/cloud/dcs/${id}/action`, {
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
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = actionMeta[action].icon;
          const isPending = pending === action;
          const isPrimary = variant === "hero" && action === "restart";
          const isDestructive = action === "flush";

          return (
            <ConsoleActionButton
              disabled={!healthy || !!pending}
              key={action}
              onClick={() => runAction(action)}
              prominence={isPrimary ? "hero" : "default"}
              tone={isPrimary ? "primary" : isDestructive ? "danger" : "neutral"}
              title={
                healthy
                  ? actionMeta[action].prompt
                  : "Actions are available only when the DCS instance is running."
              }
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4" />
              )}
              {actionMeta[action].label}
            </ConsoleActionButton>
          );
        })}
      </div>
      {message ? <ConsoleActionFeedback>{message}</ConsoleActionFeedback> : null}
    </ConsoleActionStack>
  );
}
