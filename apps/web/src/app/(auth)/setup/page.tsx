import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAnyUser } from "@/server/auth";
import { env } from "@/server/env";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Set up · SitePulse" };

/** First-run screen: only reachable while the instance has no accounts. */
export default async function SetupPage() {
  if (env().DEMO_MODE || (await hasAnyUser())) redirect("/login");

  return (
    <>
      <h1 className="text-xl font-semibold">Set up SitePulse</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Create the admin account for this instance. Sign-up closes as soon as it exists.
      </p>
      <Suspense>
        <AuthForm mode="setup" />
      </Suspense>
    </>
  );
}
