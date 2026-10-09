"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";
import { ConsoleButton } from "@/components/console-ui";

export function ManagementTaskRefresh({ id }: { id: string }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState("");
  async function refresh() {
    setPending(true); setError("");
    try {
      const response = await fetch(`/api/cloud/operations/${encodeURIComponent(id)}`);
      const body = await response.json();
      if (!response.ok) throw new Error(body.error ?? "Could not load operation progress.");
      router.refresh();
    } catch (error) { setError(error instanceof Error ? error.message : "Could not load operation progress."); }
    finally { setPending(false); }
  }
  return <div><ConsoleButton variant="neutral" disabled={pending} onClick={refresh}>{pending ? <Loader2 className="size-4 animate-spin" /> : null}Check progress</ConsoleButton>{error ? <p role="alert" className="mt-1 text-xs text-red-700">{error}</p> : null}</div>;
}
