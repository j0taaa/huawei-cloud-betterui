"use client";

import { useState } from "react";
import { LogOut } from "lucide-react";

export function LogoutButton() {
  const [loading, setLoading] = useState(false);

  async function logout() {
    setLoading(true);
    await fetch("/api/auth/logout", { method: "POST" }).catch(() => null);
    window.location.assign("/login");
  }

  return (
    <button
      aria-label="Sign out"
      className="grid size-9 place-items-center rounded-lg border border-[#d9e0eb] bg-white text-[#667085] transition hover:bg-[#f8fafc] hover:text-[#101828] disabled:opacity-60"
      disabled={loading}
      onClick={logout}
      title="Sign out"
      type="button"
    >
      <LogOut className="size-4" />
    </button>
  );
}
