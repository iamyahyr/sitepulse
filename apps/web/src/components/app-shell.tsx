import type { ReactNode } from "react";
import { MobileNav } from "@/components/mobile-nav";
import { Brand, NavLinks, SignOutButton } from "@/components/nav";

const DEMO_SCHEDULE =
  "These sites are served by a built-in service that fails on purpose on a fixed schedule: the shop returns 502 for 5 minutes every 4 hours, the API hangs every 6 hours and the blog slows down 5× for an hour every 4 hours. Checks run every minute, so incidents open and close while you watch. The week before you arrived was generated from the same schedule.";

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
      <header className="border-border bg-surface/85 sticky top-0 z-30 border-b pt-[env(safe-area-inset-top)] backdrop-blur-md md:hidden print:hidden">
        <div className="flex h-14 items-center justify-between pr-4 pl-2">
          <Brand />
          <MobileNav user={user} demo={demo} />
        </div>
      </header>
      {/* The column stretches with the page (border and background); the menu inside stays pinned. */}
      <div className="border-border bg-surface hidden w-56 shrink-0 border-r md:block print:hidden">
        <aside className="sticky top-0 flex h-screen flex-col gap-1 px-3 py-5">
          <div className="mb-6">
            <Brand />
          </div>
          <NavLinks />
          <div className="border-border mt-auto flex flex-col border-t pt-4">
            <div className="min-w-0 px-2 pb-2">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted truncate text-xs">{user.email}</p>
            </div>
            {!demo && <SignOutButton />}
          </div>
        </aside>
      </div>
      <main className="min-w-0 flex-1 px-4 pt-5 pb-[max(2rem,env(safe-area-inset-bottom))] md:px-8 md:py-8 print:p-0">
        {demo && (
          <div className="border-suspect/40 bg-suspect/10 mx-auto mb-6 max-w-6xl rounded-lg border px-4 py-3 text-sm leading-relaxed print:hidden">
            <p>
              <strong>Live, read-only demo.</strong> <span className="hidden md:inline">{DEMO_SCHEDULE}</span>
            </p>
            {/* Six lines of explanation above every page are too much on a phone: fold them away. */}
            <details className="md:hidden">
              <summary className="text-muted cursor-pointer list-none py-1 [&::-webkit-details-marker]:hidden">
                <span className="underline underline-offset-4">How this demo works</span>
              </summary>
              <p className="mt-1">{DEMO_SCHEDULE}</p>
            </details>
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
