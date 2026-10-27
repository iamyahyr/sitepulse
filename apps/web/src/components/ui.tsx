import type { ComponentProps, ReactNode } from "react";

const BUTTON_VARIANTS = {
  primary: "bg-foreground text-background hover:opacity-90",
  secondary: "border-border bg-surface hover:bg-surface-muted border",
  danger: "bg-down text-white hover:opacity-90",
  ghost: "hover:bg-surface-muted text-muted hover:text-foreground",
} as const;

export function buttonClass(variant: keyof typeof BUTTON_VARIANTS = "primary", extra = "") {
  return `inline-flex h-9 items-center justify-center gap-2 rounded-md px-3.5 text-sm font-medium transition disabled:pointer-events-none disabled:opacity-50 ${BUTTON_VARIANTS[variant]} ${extra}`;
}

export function Button({
  variant = "primary",
  className = "",
  ...props
}: ComponentProps<"button"> & { variant?: keyof typeof BUTTON_VARIANTS }) {
  return <button className={buttonClass(variant, className)} {...props} />;
}

const FIELD_CONTROL =
  "border-border bg-surface placeholder:text-muted/70 focus:border-foreground/40 focus:ring-foreground/10 h-9 w-full rounded-md border px-3 text-sm outline-none focus:ring-2 aria-invalid:border-down";

export function Input({ className = "", ...props }: ComponentProps<"input">) {
  return <input className={`${FIELD_CONTROL} ${className}`} {...props} />;
}

export function Select({ className = "", ...props }: ComponentProps<"select">) {
  return <select className={`${FIELD_CONTROL} ${className}`} {...props} />;
}

export function Field({
  id,
  label,
  hint,
  error,
  children,
}: {
  id: string;
  label: string;
  hint?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="grid gap-1.5">
      <label htmlFor={id} className="text-sm font-medium">
        {label}
      </label>
      {children}
      {error ? (
        <p id={`${id}-error`} className="text-down text-xs">
          {error}
        </p>
      ) : (
        hint && <p className="text-muted text-xs">{hint}</p>
      )}
    </div>
  );
}
