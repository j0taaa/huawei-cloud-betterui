"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  Loader2,
  LockKeyhole,
  Server,
  ShieldCheck,
} from "lucide-react";

type LoginResult = {
  error?: string;
  ok?: boolean;
};

const defaultIamEndpoint = "https://iam.myhuaweicloud.com";
const defaultProjectName = "sa-brazil-1";

export function LoginForm() {
  const [accountName, setAccountName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [projectName, setProjectName] = useState(defaultProjectName);
  const [region, setRegion] = useState(defaultProjectName);
  const [iamEndpoint, setIamEndpoint] = useState(defaultIamEndpoint);
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  const nextPath = useMemo(() => {
    if (typeof window === "undefined") {
      return "/";
    }

    const next = new URLSearchParams(window.location.search).get("next");
    return next && next.startsWith("/") ? next : "/";
  }, []);

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);

    const response = await fetch("/api/auth/iam/login", {
      body: JSON.stringify({
        accountName,
        iamEndpoint,
        password,
        projectName,
        region,
        username,
      }),
      headers: {
        "Content-Type": "application/json",
      },
      method: "POST",
    });

    const result = (await response.json().catch(() => ({}))) as LoginResult;

    if (!response.ok || !result.ok) {
      setError(result.error ?? "Huawei IAM login failed.");
      setLoading(false);
      return;
    }

    window.location.assign(nextPath);
  }

  return (
    <div className="grid min-h-screen bg-[#f4f7fb] text-[#101828] lg:grid-cols-[minmax(0,0.9fr)_minmax(520px,1fr)]">
      <aside className="hidden border-r border-[#e4e9f2] bg-white p-10 lg:flex lg:flex-col lg:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <div className="grid size-12 place-items-center rounded-xl bg-[#d7000f] text-xl font-black text-white">
              H
            </div>
            <div>
              <p className="text-xl font-black tracking-tight">
                HUAWEI CLOUD
              </p>
              <p className="text-sm font-bold text-[#667085]">
                Better Console
              </p>
            </div>
          </div>

          <div className="mt-16 max-w-md">
            <p className="text-sm font-black uppercase tracking-[0.18em] text-[#2563eb]">
              IAM access
            </p>
            <h1 className="mt-4 text-5xl font-black tracking-tight">
              Sign in with a real Huawei Cloud IAM user.
            </h1>
            <p className="mt-5 text-base font-medium leading-8 text-[#667085]">
              Better UI exchanges your IAM credentials server-side for a Huawei
              Cloud token, then keeps the session in an HTTP-only cookie.
            </p>
          </div>
        </div>

        <div className="grid gap-3">
          {[
            ["Official token flow", ShieldCheck],
            ["No browser-readable cloud token", LockKeyhole],
            ["Ready for real resource APIs", Server],
          ].map(([label, Icon]) => (
            <div
              className="flex items-center gap-3 rounded-xl border border-[#e4e9f2] bg-[#fbfcfe] p-4 text-sm font-bold"
              key={label as string}
            >
              <div className="grid size-9 place-items-center rounded-lg bg-[#eef4ff] text-[#2563eb]">
                <Icon className="size-4" />
              </div>
              {label as string}
            </div>
          ))}
        </div>
      </aside>

      <main className="flex items-center justify-center p-4 lg:p-10">
        <section className="w-full max-w-xl rounded-2xl border border-[#e4e9f2] bg-white p-6 shadow-[0_24px_80px_rgba(16,24,40,0.12)] sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-[#2563eb]">
                Login
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">
                Huawei Cloud IAM
              </h2>
            </div>
            <div className="grid size-12 place-items-center rounded-xl bg-[#eef4ff] text-[#2563eb]">
              <Cloud className="size-6" />
            </div>
          </div>

          <div className="mt-6 rounded-xl border border-[#dbe7ff] bg-[#f5f8ff] p-4 text-sm font-semibold leading-6 text-[#344054]">
            Use an IAM user, not your HUAWEI ID. Huawei does not expose a
            public API token exchange for direct HUAWEI ID password login.
          </div>

          <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
            <label className="grid gap-2 text-sm font-bold">
              Account or tenant name
              <input
                autoComplete="organization"
                className="h-12 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-semibold outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                onChange={(event) => setAccountName(event.target.value)}
                placeholder="Example: g50047609 or account domain"
                required
                value={accountName}
              />
            </label>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">
                IAM username
                <input
                  autoComplete="username"
                  className="h-12 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-semibold outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                  onChange={(event) => setUsername(event.target.value)}
                  placeholder="iam-user"
                  required
                  value={username}
                />
              </label>

              <label className="grid gap-2 text-sm font-bold">
                Password
                <span className="relative">
                  <input
                    autoComplete="current-password"
                    className="h-12 w-full rounded-lg border border-[#d9e0eb] bg-white px-4 pr-11 text-sm font-semibold outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder="IAM password"
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <button
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-[#667085]"
                    onClick={() => setShowPassword(!showPassword)}
                    type="button"
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </button>
                </span>
              </label>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <label className="grid gap-2 text-sm font-bold">
                Project name
                <input
                  className="h-12 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-semibold outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                  onChange={(event) => {
                    setProjectName(event.target.value);
                    setRegion(event.target.value);
                  }}
                  placeholder="sa-brazil-1"
                  required
                  value={projectName}
                />
              </label>

              <label className="grid gap-2 text-sm font-bold">
                IAM endpoint
                <input
                  className="h-12 rounded-lg border border-[#d9e0eb] bg-white px-4 text-sm font-semibold outline-none transition focus:border-[#2563eb] focus:ring-4 focus:ring-[#2563eb]/10"
                  onChange={(event) => setIamEndpoint(event.target.value)}
                  placeholder={defaultIamEndpoint}
                  required
                  type="url"
                  value={iamEndpoint}
                />
              </label>
            </div>

            <input name="region" type="hidden" value={region} />

            {error ? (
              <div className="rounded-xl border border-[#fecdd3] bg-[#fff1f2] p-4 text-sm font-bold leading-6 text-[#b42318]">
                {error}
              </div>
            ) : null}

            <button
              className="mt-2 flex h-12 items-center justify-center gap-2 rounded-lg bg-[#2563eb] px-5 text-sm font-black text-white shadow-[0_14px_32px_rgba(37,99,235,0.28)] transition hover:bg-[#1d4ed8] disabled:cursor-not-allowed disabled:opacity-70"
              disabled={loading}
              type="submit"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Sign in
              <ArrowRight className="size-4" />
            </button>
          </form>
        </section>
      </main>
    </div>
  );
}
