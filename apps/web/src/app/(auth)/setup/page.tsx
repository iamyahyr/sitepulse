import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { hasAnyUser } from "@/server/auth";
import { env } from "@/server/env";
import { announceSetupLink, isSetupToken } from "@/server/setup-token";
import { AuthForm } from "../auth-form";

export const metadata: Metadata = { title: "Set up · SitePulse" };

/** First-run screen: only reachable while the instance has no accounts, and only with the link from the logs. */
export default async function SetupPage({ searchParams }: PageProps<"/setup">) {
  if (env().DEMO_MODE || (await hasAnyUser())) redirect("/login");

  const token = (await searchParams).token;
  if (typeof token !== "string" || !isSetupToken(token)) {
    announceSetupLink();
    return (
      <>
        <h1 className="text-xl font-semibold">Set up SitePulse</h1>
        <p className="text-muted mt-1 text-sm leading-relaxed">
          To prove this server is yours, open the setup link printed in the web app&apos;s logs:
        </p>
        <pre className="bg-surface-muted mt-4 overflow-x-auto rounded-md px-3 py-2 font-mono text-xs">docker compose logs web</pre>
      </>
    );
  }

  return (
    <>
      <h1 className="text-xl font-semibold">Set up SitePulse</h1>
      <p className="text-muted mt-1 mb-6 text-sm">
        Create the admin account for this instance. Sign-up closes as soon as it exists.
      </p>
      <Suspense>
        <AuthForm mode="setup" setupToken={token} />
      </Suspense>
    </>
  );
}
