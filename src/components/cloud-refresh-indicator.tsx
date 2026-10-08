"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { Loader2 } from "lucide-react";

export function CloudRefreshIndicator({ show }: { show: boolean }) {
  const router = useRouter();

  useEffect(() => {
    if (!show) {
      return;
    }

    const timeout = window.setInterval(() => {
      router.refresh();
    }, 1500);

    return () => window.clearInterval(timeout);
  }, [router, show]);

  if (!show) {
    return null;
  }

  return (
    <div className="fixed bottom-4 right-4 z-50 flex items-center gap-2 rounded-full border border-[#d9e0eb] bg-white/95 px-4 py-2 text-xs font-black text-[#344054] shadow-[0_16px_40px_rgba(16,24,40,0.18)] backdrop-blur">
      <Loader2 className="size-4 animate-spin text-[#2563eb]" />
      Updating data
    </div>
  );
}
