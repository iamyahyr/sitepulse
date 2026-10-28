import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAnyUser } from "@/server/auth";
import { env } from "@/server/env";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Sign in · SitePulse" };

export default async function LoginPage() {
  // In the demo the layout already sends visitors in once the worker has
  // created the demo account; until then there is nothing to sign in to.
  if (env().DEMO_MODE) {
    return (
      <>
        <h1 className="text-xl font-semibold">The demo is warming up</h1>
        <p className="text-muted mt-1 text-sm">The worker is preparing a week of history. Refresh in a few seconds.</p>
      </>
    );
  }
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
