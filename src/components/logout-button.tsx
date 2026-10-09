"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { LogOut } from "lucide-react";

import { ConsoleIconButton } from "@/components/console-ui";

export function LogoutButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    router.replace("/login");
    router.refresh();
  }

  return (
    <ConsoleIconButton
      aria-label="Sign out"
      className="size-9 rounded-lg"
      disabled={loading}
      onClick={logout}
      title="Sign out"
      variant="neutral"
    >
      <LogOut className="size-4" />
    </ConsoleIconButton>
  );
}
