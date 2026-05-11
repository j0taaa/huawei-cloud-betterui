import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { LoginForm } from "@/components/login-form";
import { getCurrentSession } from "@/lib/auth-session";

export const metadata: Metadata = {
  title: "Login | Huawei Cloud Better UI",
};

export default async function LoginPage() {
  const session = await getCurrentSession();

  if (session) {
    redirect("/");
  }

  return <LoginForm />;
}
