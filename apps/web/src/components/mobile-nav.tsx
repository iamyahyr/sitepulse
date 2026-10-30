"use client";

import { Menu, X } from "lucide-react";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import { Brand, NavLinks, SignOutButton } from "@/components/nav";

/**
 * The menu button of the mobile top bar and the drawer it opens. A modal
 * <dialog> gives focus trapping, Escape and scroll locking for free.
 */
export function MobileNav({ user, demo }: { user: { name: string; email: string }; demo: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const pathname = usePathname();
  const close = () => dialog.current?.close();

  // Back/forward navigation does not go through a link click.
  useEffect(() => {
    dialog.current?.close();
  }, [pathname]);

  return (
    <>
      <button
        type="button"
        onClick={() => dialog.current?.showModal()}
        className="hover:bg-surface-muted -mr-2 inline-flex size-10 items-center justify-center rounded-lg"
        aria-label="Open menu"
        aria-haspopup="dialog"
      >
        <Menu className="size-5" aria-hidden />
      </button>
      <dialog
        ref={dialog}
        aria-label="Menu"
        // A click on the backdrop lands on the dialog itself, outside its panel.
        onClick={(e) => e.target === e.currentTarget && close()}
        className="border-border bg-surface text-foreground m-0 h-dvh max-h-none w-[min(20rem,85vw)] max-w-none -translate-x-full border-r p-0 transition-[translate,display,overlay] transition-discrete duration-200 ease-out backdrop:bg-black/50 backdrop:opacity-0 backdrop:transition-[opacity,display,overlay] backdrop:transition-discrete backdrop:duration-200 open:translate-x-0 open:backdrop:opacity-100 starting:open:-translate-x-full starting:open:backdrop:opacity-0 motion-reduce:transition-none"
      >
        <nav
          aria-label="Main"
          className="flex h-full flex-col px-3 pt-[max(0.75rem,env(safe-area-inset-top))] pb-[max(1rem,env(safe-area-inset-bottom))]"
        >
          <div className="mb-4 flex h-11 items-center justify-between">
            <Brand onNavigate={close} />
            <button
              type="button"
              onClick={close}
              className="hover:bg-surface-muted inline-flex size-10 items-center justify-center rounded-lg"
              aria-label="Close menu"
            >
              <X className="size-5" aria-hidden />
            </button>
          </div>
          <div className="grid gap-0.5">
            <NavLinks size="touch" onNavigate={close} />
          </div>
          <div className="border-border mt-auto border-t pt-4">
            <div className="min-w-0 px-3 pb-2">
              <p className="truncate text-sm font-medium">{user.name}</p>
              <p className="text-muted truncate text-xs">{user.email}</p>
            </div>
            {!demo && <SignOutButton size="touch" />}
          </div>
        </nav>
      </dialog>
    </>
  );
}
