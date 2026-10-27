import { Activity, Bell, Globe, LayoutDashboard, Settings, TriangleAlert } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, ready: true },
  { href: "/sites", label: "Sites", icon: Globe, ready: false },
  { href: "/incidents", label: "Incidents", icon: TriangleAlert, ready: false },
  { href: "/alerts", label: "Alerts", icon: Bell, ready: false },
  { href: "/settings", label: "Settings", icon: Settings, ready: false },
] as const;

export function AppShell({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen flex-col md:flex-row">
      <aside className="border-border bg-surface flex shrink-0 items-center gap-1 overflow-x-auto border-b px-4 py-3 md:w-56 md:flex-col md:items-stretch md:border-r md:border-b-0 md:px-3 md:py-5">
        <Link href="/" className="mr-3 flex items-center gap-2 px-2 font-semibold tracking-tight md:mr-0 md:mb-6">
          <Activity className="text-up size-5" aria-hidden />
          SitePulse
        </Link>
        {NAV.map(({ href, label, icon: Icon, ready }) =>
          ready ? (
            <Link
              key={href}
              href={href}
              className="bg-surface-muted flex items-center gap-2 rounded-md px-2 py-1.5 text-sm font-medium"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </Link>
          ) : (
            <span
              key={href}
              className="text-muted flex cursor-not-allowed items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap"
              title="Coming soon"
            >
              <Icon className="size-4" aria-hidden />
              {label}
            </span>
          ),
        )}
      </aside>
      <main className="min-w-0 flex-1 px-4 py-6 md:px-8 md:py-8">{children}</main>
    </div>
  );
}
