"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Loader2, RefreshCw } from "lucide-react";

import { ConsoleButton } from "@/components/console-ui";

export function RefreshButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  return (
    <ConsoleButton
      disabled={loading}
      onClick={() => {
        setLoading(true);
        router.refresh();
        setTimeout(() => setLoading(false), 500);
      }}
      size="lg"
      variant="neutral"
    >
      {loading ? (
        <Loader2 className="size-4 animate-spin" />
      ) : (
        <RefreshCw className="size-4" />
      )}
      Refresh
    </ConsoleButton>
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
    <ConsoleButton
      className="text-[#98a2b3]"
      disabled
      size="lg"
      title={title}
      variant="neutral"
    >
      {children}
    </ConsoleButton>
  );
}
