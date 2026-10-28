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
      {/* The column stretches with the page (border and background); the menu inside stays pinned. */}
      <div className="border-border bg-surface shrink-0 border-b md:w-56 md:border-r md:border-b-0">
        <aside className="flex items-center gap-1 overflow-x-auto px-4 py-3 md:sticky md:top-0 md:h-screen md:flex-col md:items-stretch md:px-3 md:py-5">
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
            {!demo && <SignOutButton />}
          </div>
        </aside>
      </div>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">
        {demo && (
          <div className="border-suspect/40 bg-suspect/10 mx-auto mb-6 max-w-6xl rounded-lg border px-4 py-3 text-sm leading-relaxed">
            <p>
              <strong>Live, read-only demo.</strong> These sites are served by a built-in service that fails on purpose
              on a fixed schedule: the shop returns 502 for 5 minutes every 4 hours, the API hangs every 6 hours and the
              blog slows down 5× for an hour every 4 hours. Checks run every minute, so incidents open and close while
              you watch. The week before you arrived was generated from the same schedule.
            </p>
            <p className="mt-1">
              <a
                href="https://github.com/iamyahyr/sitepulse"
                className="font-medium underline underline-offset-4"
                target="_blank"
                rel="noopener noreferrer"
              >
                Self-host SitePulse
              </a>{" "}
              to monitor your own sites.
            </p>
          </div>
        )}
        {children}
      </main>
    </div>
  );
}
