"use client";

import { Bell, Globe, LayoutDashboard, LogOut, Settings, TriangleAlert } from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";

const NAV = [
  { href: "/", label: "Dashboard", icon: LayoutDashboard, ready: true },
  { href: "/sites", label: "Sites", icon: Globe, ready: true },
  { href: "/incidents", label: "Incidents", icon: TriangleAlert, ready: false },
  { href: "/alerts", label: "Alerts", icon: Bell, ready: false },
  { href: "/settings", label: "Settings", icon: Settings, ready: false },
] as const;

const ITEM = "flex items-center gap-2 rounded-md px-2 py-1.5 text-sm whitespace-nowrap";

export function NavLinks() {
  const pathname = usePathname();

  return NAV.map(({ href, label, icon: Icon, ready }) => {
    if (!ready) {
      return (
        <span key={href} className={`${ITEM} text-muted/70 cursor-not-allowed`} title="Coming soon">
          <Icon className="size-4" aria-hidden />
          {label}
        </span>
      );
    }
    const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
    return (
      <Link
        key={href}
        href={href}
        aria-current={active ? "page" : undefined}
        className={`${ITEM} ${active ? "bg-surface-muted font-medium" : "text-muted hover:text-foreground"}`}
      >
        <Icon className="size-4" aria-hidden />
        {label}
      </Link>
    );
  });
}

export function SignOutButton() {
  const router = useRouter();

  return (
    <button
      type="button"
      className={`${ITEM} text-muted hover:text-foreground`}
      onClick={async () => {
        await authClient.signOut();
        router.push("/login");
        router.refresh();
      }}
    >
      <LogOut className="size-4" aria-hidden />
      <span className="hidden md:inline">Sign out</span>
      <span className="sr-only md:hidden">Sign out</span>
    </button>
  );
}
