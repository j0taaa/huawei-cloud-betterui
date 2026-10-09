"use client";

import { FormEvent, useMemo, useState } from "react";
import {
  ArrowRight,
  CheckCircle2,
  Cloud,
  Eye,
  EyeOff,
  IdCard,
  Loader2,
  LockKeyhole,
  Server,
  ShieldCheck,
  UserRound,
} from "lucide-react";

import {
  ConsoleButton,
  ConsoleCallout,
  ConsoleChoiceButton,
  ConsoleFeatureList,
  ConsoleField,
  ConsoleIconButton,
  ConsoleIconTile,
  ConsoleInput,
} from "@/components/console-ui";

type LoginResult = {
  error?: string;
  ok?: boolean;
};

const defaultIamEndpoint = "https://iam.myhuaweicloud.com";
const loginTypes = {
  huaweiId: {
    description: "Account and password",
    label: "Huawei ID",
  },
  iam: {
    description: "Account, IAM username, and password",
    label: "IAM",
  },
} as const;

type LoginType = keyof typeof loginTypes;

export function LoginForm() {
  const [loginType, setLoginType] = useState<LoginType>("huaweiId");
  const [accountName, setAccountName] = useState("");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
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

    const submittedAccountName = accountName.trim();
    const submittedUsername =
      loginType === "huaweiId" ? submittedAccountName : username.trim();

    const response = await fetch("/api/auth/iam/login", {
      body: JSON.stringify({
        accountName: submittedAccountName,
        iamEndpoint,
        password,
        username: submittedUsername,
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
              Huawei Cloud access
            </p>
            <h1 className="mt-4 text-5xl font-black tracking-tight">
              Sign in with Huawei ID or IAM.
            </h1>
            <p className="mt-5 text-base font-medium leading-8 text-[#667085]">
              Better UI exchanges your credentials server-side for a Huawei
              Cloud token, then keeps the session in an HTTP-only cookie.
            </p>
          </div>
        </div>

        <ConsoleFeatureList
          items={[
            { icon: ShieldCheck, label: "Official token flow" },
            { icon: LockKeyhole, label: "No browser-readable cloud token" },
            { icon: Server, label: "Ready for real resource APIs" },
          ]}
        />
      </aside>

      <main className="flex items-center justify-center p-4 lg:p-10">
        <section className="w-full max-w-xl rounded-2xl border border-[#e4e9f2] bg-white p-6 shadow-[0_24px_80px_rgba(16,24,40,0.12)] sm:p-8">
          <div className="flex items-center justify-between gap-4">
            <div>
              <p className="text-sm font-black uppercase tracking-[0.16em] text-[#2563eb]">
                Login
              </p>
              <h2 className="mt-2 text-3xl font-black tracking-tight">
                Huawei Cloud
              </h2>
            </div>
            <ConsoleIconTile>
              <Cloud className="size-6" />
            </ConsoleIconTile>
          </div>

          <form className="mt-6 grid gap-4" onSubmit={handleSubmit}>
            <ConsoleField as="div" label="Login type">
              <div className="grid gap-2 sm:grid-cols-2" role="radiogroup">
                {(
                  [
                    ["huaweiId", UserRound],
                    ["iam", IdCard],
                  ] as const
                ).map(([type, Icon]) => {
                  const selected = loginType === type;

                  return (
                    <ConsoleChoiceButton
                      aria-checked={selected}
                      description={loginTypes[type].description}
                      icon={Icon}
                      key={type}
                      label={loginTypes[type].label}
                      onClick={() => {
                        setLoginType(type);
                        setError("");
                      }}
                      role="radio"
                      selected={selected}
                    />
                  );
                })}
              </div>
            </ConsoleField>

            <ConsoleField
              label={loginType === "huaweiId" ? "Huawei ID account" : "Account or tenant name"}
            >
              <ConsoleInput
                autoComplete="organization"
                className="h-12 px-4 focus:ring-4 focus:ring-[#2563eb]/10"
                onChange={(event) => setAccountName(event.target.value)}
                placeholder={
                  loginType === "huaweiId"
                    ? "Huawei ID account"
                    : "Example: g50047609 or account domain"
                }
                required
                value={accountName}
              />
            </ConsoleField>

            <div
              className={`grid gap-4 ${loginType === "iam" ? "sm:grid-cols-2" : ""}`}
            >
              {loginType === "iam" ? (
                <ConsoleField label="IAM username">
                  <ConsoleInput
                    autoComplete="username"
                    className="h-12 px-4 focus:ring-4 focus:ring-[#2563eb]/10"
                    onChange={(event) => setUsername(event.target.value)}
                    placeholder="iam-user"
                    required
                    value={username}
                  />
                </ConsoleField>
              ) : null}

              <ConsoleField as="div" label={<label htmlFor="login-password">Password</label>}>
                <span className="relative">
                  <ConsoleInput
                    autoComplete="current-password"
                    className="h-12 px-4 pr-11 focus:ring-4 focus:ring-[#2563eb]/10"
                    id="login-password"
                    onChange={(event) => setPassword(event.target.value)}
                    placeholder={
                      loginType === "huaweiId"
                        ? "Huawei ID password"
                        : "IAM password"
                    }
                    required
                    type={showPassword ? "text" : "password"}
                    value={password}
                  />
                  <ConsoleIconButton
                    aria-label={showPassword ? "Hide password" : "Show password"}
                    className="absolute right-2 top-1/2 -translate-y-1/2"
                    onClick={() => setShowPassword(!showPassword)}
                  >
                    {showPassword ? (
                      <EyeOff className="size-4" />
                    ) : (
                      <Eye className="size-4" />
                    )}
                  </ConsoleIconButton>
                </span>
              </ConsoleField>
            </div>

            <div className="grid gap-4 sm:grid-cols-2">
              <ConsoleField label="IAM endpoint">
                <ConsoleInput
                  className="h-12 px-4 focus:ring-4 focus:ring-[#2563eb]/10"
                  onChange={(event) => setIamEndpoint(event.target.value)}
                  placeholder={defaultIamEndpoint}
                  required
                  type="url"
                  value={iamEndpoint}
                />
              </ConsoleField>
            </div>

            {error ? (
              <ConsoleCallout className="leading-6">
                {error}
              </ConsoleCallout>
            ) : null}

            <ConsoleButton
              className="mt-2 h-12 font-black shadow-[0_14px_32px_rgba(37,99,235,0.28)]"
              disabled={loading}
              size="lg"
              type="submit"
            >
              {loading ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <CheckCircle2 className="size-4" />
              )}
              Sign in
              <ArrowRight className="size-4" />
            </ConsoleButton>
          </form>
        </section>
      </main>
    </div>
  );
}
