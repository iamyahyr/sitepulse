import { Activity } from "lucide-react";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { getSessionUser } from "@/server/session";

export default async function AuthLayout({ children }: { children: ReactNode }) {
  if (await getSessionUser()) redirect("/");

  return (
    <main className="flex min-h-screen flex-col items-center justify-start px-4 pt-16 pb-16 sm:justify-center sm:pt-0">
      <p className="mb-6 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <Activity className="text-up size-5" aria-hidden />
        SitePulse
      </p>
      <div className="border-border bg-surface w-full max-w-sm rounded-xl border p-6 sm:p-8">{children}</div>
    </main>
  );
}
