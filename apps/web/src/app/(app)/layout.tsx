import type { ReactNode } from "react";
import { AppShell } from "@/components/app-shell";
import { env } from "@/server/env";
import { requireUser } from "@/server/session";

export default async function AppLayout({ children }: { children: ReactNode }) {
  const user = await requireUser();

  return (
    <AppShell user={user} demo={env().DEMO_MODE}>
      {children}
    </AppShell>
  );
}
