"use client";

import { Loader2 } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { useState, type FormEvent } from "react";
import { Button, Field, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { SETUP_TOKEN_HEADER } from "@/lib/setup";

type Mode = "sign-in" | "setup";

/**
 * Where to go after signing in: only a path on this site. Resolving against a
 * placeholder origin catches every way to leave it ("//evil", "/\evil",
 * "https:evil"…) instead of guessing at prefixes.
 */
function safeNext(value: string | null) {
  if (!value) return "/";
  const base = "http://sitepulse.invalid";
  try {
    const url = new URL(value, base);
    return url.origin === base ? `${url.pathname}${url.search}${url.hash}` : "/";
  } catch {
    return "/";
  }
}

export function AuthForm({ mode, setupToken }: { mode: Mode; setupToken?: string }) {
  const router = useRouter();
  const next = safeNext(useSearchParams().get("next"));
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setPending(true);
    const form = new FormData(event.currentTarget);
    const email = String(form.get("email"));
    const password = String(form.get("password"));

    const { error } =
      mode === "sign-in"
        ? await authClient.signIn.email({ email, password })
        : await authClient.signUp.email(
            { name: String(form.get("name")), email, password },
            { headers: { [SETUP_TOKEN_HEADER]: setupToken ?? "" } },
          );

    if (error) {
      setPending(false);
      if (error.status === 429) setError("Too many attempts. Wait a minute and try again.");
      else if (error.code?.includes("INVALID_EMAIL_OR_PASSWORD")) setError("Wrong email or password.");
      else setError(error.message ?? "Something went wrong.");
      return;
    }
    router.push(next);
    router.refresh();
  }

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {mode === "setup" && (
        <Field id="name" label="Name">
          <Input id="name" name="name" autoComplete="name" required maxLength={80} />
        </Field>
      )}
      <Field id="email" label="Email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field id="password" label="Password" hint={mode === "setup" ? "At least 10 characters." : undefined}>
        <Input
          id="password"
          name="password"
          type="password"
          autoComplete={mode === "sign-in" ? "current-password" : "new-password"}
          minLength={10}
          required
        />
      </Field>
      {error && (
        <p role="alert" className="text-down text-sm">
          {error}
        </p>
      )}
      <Button type="submit" className="mt-1 h-10" disabled={pending}>
        {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
        {mode === "sign-in" ? "Sign in" : "Create admin account"}
      </Button>
    </form>
  );
}
