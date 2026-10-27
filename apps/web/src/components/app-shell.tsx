import { Activity } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { NavLinks, SignOutButton } from "@/components/nav";

export function AppShell({
  user,
  demo,
  children,
}: {
  user: { name: string; email: string };
  demo: boolean;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-border bg-surface flex shrink-0 items-center gap-1 overflow-x-auto border-b px-4 py-3 md:sticky md:top-0 md:h-screen md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-5">
        <Link href="/" className="mr-3 flex items-center gap-2 px-2 font-semibold tracking-tight md:mr-0 md:mb-6">
          <Activity className="text-up size-5" aria-hidden />
          SitePulse
        </Link>
        <NavLinks />
        <div className="border-border ml-auto flex items-center gap-2 md:mt-auto md:ml-0 md:flex-col md:items-stretch md:border-t md:pt-4">
          <div className="hidden min-w-0 px-2 md:block">
            <p className="truncate text-sm font-medium">{user.name}</p>
            <p className="text-muted truncate text-xs">{user.email}</p>
          </div>
          <SignOutButton />
        </div>
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        {demo && (
          <p className="border-suspect/40 bg-suspect/10 mx-auto mb-6 max-w-6xl rounded-lg border px-4 py-2 text-sm">
            Read-only demo: data is synthetic and changes are disabled.
          </p>
        )}
        {children}
      </main>
    </div>
  );
}
