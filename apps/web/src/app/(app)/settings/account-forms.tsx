"use client";

import { Loader2 } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";

type Status = { ok: boolean; message: string } | null;

function StatusLine({ status }: { status: Status }) {
  if (!status) return null;
  return (
    <p role={status.ok ? "status" : "alert"} className={`text-sm ${status.ok ? "text-up" : "text-down"}`}>
      {status.message}
    </p>
  );
}

export function ProfileForm({ name, email, disabled }: { name: string; email: string; disabled: boolean }) {
  const router = useRouter();
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const next = String(new FormData(event.currentTarget).get("name")).trim();
    if (!next) return setStatus({ ok: false, message: "Your name cannot be empty." });
    setPending(true);
    const { error } = await authClient.updateUser({ name: next });
    setPending(false);
    if (error) return setStatus({ ok: false, message: error.message ?? "Could not save your name." });
    setStatus({ ok: true, message: "Saved." });
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      <Field id="name" label="Name">
        <Input id="name" name="name" defaultValue={name} maxLength={80} required disabled={disabled} autoComplete="name" />
      </Field>
      <Field id="email" label="Email" hint="Used to sign in. It cannot be changed here.">
        <Input id="email" value={email} readOnly disabled />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || disabled} className="shrink-0">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Save
        </Button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}

export function PasswordForm({ disabled }: { disabled: boolean }) {
  const [pending, setPending] = useState(false);
  const [status, setStatus] = useState<Status>(null);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const currentPassword = String(data.get("current"));
    const newPassword = String(data.get("new"));
    if (newPassword !== String(data.get("confirm"))) {
      return setStatus({ ok: false, message: "The new passwords do not match." });
    }
    setPending(true);
    // Other devices are signed out: a password change is often a reaction to a leaked one.
    const { error } = await authClient.changePassword({ currentPassword, newPassword, revokeOtherSessions: true });
    setPending(false);
    if (error) {
      const wrong = error.code?.includes("INVALID_PASSWORD");
      return setStatus({ ok: false, message: wrong ? "The current password is wrong." : (error.message ?? "Could not change it.") });
    }
    form.reset();
    setStatus({ ok: true, message: "Password changed. Other devices were signed out." });
  }

  return (
    <form onSubmit={onSubmit} className="grid max-w-md gap-4">
      <Field id="current" label="Current password">
        <Input id="current" name="current" type="password" autoComplete="current-password" required disabled={disabled} />
      </Field>
      <Field id="new" label="New password" hint="At least 10 characters.">
        <Input id="new" name="new" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={disabled} />
      </Field>
      <Field id="confirm" label="Repeat the new password">
        <Input id="confirm" name="confirm" type="password" autoComplete="new-password" minLength={10} maxLength={128} required disabled={disabled} />
      </Field>
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending || disabled} className="shrink-0">
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          Change password
        </Button>
        <StatusLine status={status} />
      </div>
    </form>
  );
}
