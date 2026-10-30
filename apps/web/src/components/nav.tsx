"use client";

import { Activity, Bell, FileText, Globe, LayoutDashboard, LogOut, Settings, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard },
  { href: "/sites", label: "Sites", icon: Globe },
  { href: "/incidents", label: "Incidents", icon: TriangleAlert },
  { href: "/alerts", label: "Alerts", icon: Bell },
  { href: "/reports", label: "Reports", icon: FileText },
  { href: "/settings", label: "Settings", icon: Settings },
] as const;

/** Compact rows for the desktop sidebar, finger-sized ones for the mobile menu. */
const ITEM = {
  compact: "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap",
  touch: "flex items-center gap-3 rounded-lg px-3 py-2.5 text-[15px] whitespace-nowrap",
} as const;
type Size = keyof typeof ITEM;

export function Brand({ onNavigate }: { onNavigate?: () => void }) {
  return (
    <Link href="/" onClick={onNavigate} className="flex items-center gap-2 px-2 font-semibold tracking-tight">
      <Activity className="text-up size-5" aria-hidden />
      SitePulse
    </Link>
  );
}

export function NavLinks({ size = "compact", onNavigate }: { size?: Size; onNavigate?: () => void }) {
  const pathname = usePathname();

  return NAV.map(({ href, label, icon: Icon }) => {
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        onClick={onNavigate}
        aria-current={active ? "page" : undefined}
        className={`${ITEM[size]} ${active ? "bg-surface-muted font-medium" : "text-muted hover:text-foreground"}`}
      >
        <Icon className="size-4" aria-hidden />
        {label}
      </Link>
    );
  });
}

export function SignOutButton({ size = "compact" }: { size?: Size }) {
  const router = useRouter();

  return (
    <button
      type="button"
      className={`${ITEM[size]} text-muted hover:text-foreground w-full`}
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden />
      Sign out
    </button>
  );
}
