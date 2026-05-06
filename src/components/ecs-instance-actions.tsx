"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, Play, RefreshCw, Square } from "lucide-react";

type EcsAction = "restart" | "start" | "stop";

const actionMeta = {
  restart: {
    icon: RefreshCw,
    label: "Restart",
    prompt: "Restart this ECS instance now?",
  },
  start: {
    icon: Play,
    label: "Start",
    prompt: "Start this ECS instance now?",
  },
  stop: {
    icon: Square,
    label: "Stop",
    prompt: "Stop this ECS instance now?",
  },
} as const;

export function EcsInstanceActions({
  id,
  projectId,
  status,
}: {
  id: string;
  projectId?: string;
  status: string;
}) {
  const router = useRouter();
  const [pending, setPending] = useState<EcsAction | null>(null);
  const [message, setMessage] = useState("");

  const actions: EcsAction[] =
    status === "ACTIVE" ? ["restart", "stop"] : ["start"];

  async function runAction(action: EcsAction) {
    if (!window.confirm(actionMeta[action].prompt)) {
      return;
    }

    setPending(action);
    setMessage("");

    const response = await fetch(`/api/cloud/ecs/${id}/action`, {
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

    setMessage(result.jobId ? `Job submitted: ${result.jobId}` : "Action submitted.");
    setPending(null);
    router.refresh();
  }

  return (
    <div className="grid gap-2">
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => {
          const Icon = actionMeta[action].icon;
          const isPending = pending === action;

          return (
            <button
              className="flex h-10 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-3 text-sm font-bold shadow-sm hover:bg-[#f8fafc] disabled:opacity-70"
              disabled={!!pending}
              key={action}
              onClick={() => runAction(action)}
              type="button"
            >
              {isPending ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <Icon className="size-4" />
              )}
              {actionMeta[action].label}
            </button>
          );
        })}
      </div>
      {message ? (
        <p className="text-sm font-bold text-[#2563eb]">{message}</p>
      ) : null}
    </div>
  );
}
