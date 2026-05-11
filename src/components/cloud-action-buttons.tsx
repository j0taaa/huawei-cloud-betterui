"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

export function RefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <button
      className="flex h-11 items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold shadow-sm hover:bg-[#f8fafc] disabled:opacity-70"
      disabled={loading}
      onClick={() => {
        setLoading(true);
        router.refresh();
        setTimeout(() => setLoading(false), 500);
      }}
      type="button"
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      Refresh
    </button>
  );
}

export function DisabledCloudButton({
  children,
  title = "Not available in this version",
}: {
  children: React.ReactNode;
  title?: string;
}) {
  return (
    <button
      className="flex h-11 cursor-not-allowed items-center gap-2 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-bold text-[#98a2b3] shadow-sm"
      disabled
      title={title}
      type="button"
    >
      {children}
    </button>
  );
}
