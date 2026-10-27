import type { ReactNode } from "react";

export function Card({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <section className="border-border bg-surface rounded-xl border">
      <header className="border-border flex items-center justify-between gap-4 border-b px-5 py-3">
        <h2 className="text-sm font-semibold">{title}</h2>
        {action}
      </header>
      <div className="p-5">{children}</div>
    </section>
  );
}

export function EmptyState({ title, children }: { title: string; children?: ReactNode }) {
  return (
    <div className="py-8 text-center">
      <p className="font-medium">{title}</p>
      {children && <div className="text-muted mt-1 text-sm">{children}</div>}
    </div>
  );
}
