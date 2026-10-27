import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAnyUser } from "@/server/auth";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in · SitePulse" };

export default async function LoginPage() {
  if (!(await hasAnyUser())) redirect("/setup");

  return (
    <>
      <h1 className="text-xl font-semibold">Sign in</h1>
      <p className="text-muted mt-1 mb-6 text-sm">Welcome back to your monitors.</p>
      <Suspense>
        <AuthForm mode="sign-in" />
      </Suspense>
    </>
  );
}
