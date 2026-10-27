"use client";

import { Loader2 } from "lucide-react";
import Link from "next/link";
import { useActionState } from "react";
import { Button, Field, Input, Select, buttonClass } from "@/components/ui";
import { INTERVAL_OPTIONS, TIMEOUT_OPTIONS, type SiteFormState, type SiteFormValues } from "@/lib/site-options";

type Action = (state: SiteFormState, formData: FormData) => Promise<SiteFormState>;

export function SiteForm({
  action,
  initial,
  minIntervalSec,
  submitLabel,
  cancelHref,
  channels,
}: {
  channels: { id: string; name: string; type: "discord" | "webhook" }[];
  action: Action;
  initial: SiteFormValues;
  minIntervalSec: number;
  submitLabel: string;
  cancelHref: string;
}) {
  const [state, formAction, pending] = useActionState(action, { values: initial });
  const { values, fieldErrors = {} } = state;
  const invalid = (key: keyof SiteFormValues) =>
    fieldErrors[key] ? { "aria-invalid": true, "aria-describedby": `${key}-error` } : {};

  return (
    // Keyed on the returned values so a failed submit re-renders with what the user typed.
    <form action={formAction} key={JSON.stringify(values)} className="grid max-w-xl gap-5">
      <Field id="name" label="Name" error={fieldErrors.name}>
        <Input id="name" name="name" defaultValue={values.name} placeholder="Client A website" required maxLength={80} {...invalid("name")} />
      </Field>

      <Field
        id="url"
        label="URL"
        error={fieldErrors.url}
        hint="Public http(s) address. Redirects are followed (up to 5) and the final response is checked."
      >
        <Input id="url" name="url" type="url" inputMode="url" defaultValue={values.url} required {...invalid("url")} />
      </Field>

      <Field id="client" label="Client (optional)" error={fieldErrors.client} hint="Groups sites for status pages and reports.">
        <Input id="client" name="client" defaultValue={values.client} placeholder="Acme Studio" maxLength={80} {...invalid("client")} />
      </Field>

      <div className="grid gap-5 sm:grid-cols-2">
        <Field id="intervalSec" label="Check frequency" error={fieldErrors.intervalSec}>
          <Select id="intervalSec" name="intervalSec" defaultValue={values.intervalSec} {...invalid("intervalSec")}>
            {INTERVAL_OPTIONS.filter((o) => o.value >= minIntervalSec).map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
        <Field id="timeoutMs" label="Timeout" error={fieldErrors.timeoutMs}>
          <Select id="timeoutMs" name="timeoutMs" defaultValue={values.timeoutMs} {...invalid("timeoutMs")}>
            {TIMEOUT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <Field
        id="expectedStatus"
        label="Expected status"
        error={fieldErrors.expectedStatus}
        hint="Anything else counts as a failure. 200-399 by default; a 404 is reported as such, not as the server being down."
      >
        <Input
          id="expectedStatus"
          name="expectedStatus"
          defaultValue={values.expectedStatus}
          className="font-mono"
          required
          {...invalid("expectedStatus")}
        />
      </Field>

      <fieldset className="grid gap-2">
        <legend className="mb-1.5 text-sm font-medium">Alert channels</legend>
        {channels.length === 0 ? (
          <p className="text-muted text-xs">
            No channels yet.{" "}
            <Link href="/alerts" className="underline underline-offset-4">
              Add Discord or a webhook
            </Link>{" "}
            to be notified when this site goes down and recovers.
          </p>
        ) : (
          channels.map((channel) => (
            <label key={channel.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="channelIds"
                value={channel.id}
                defaultChecked={values.channelIds.includes(channel.id)}
                className="size-4"
              />
              {channel.name}
              <span className="text-muted text-xs">{channel.type === "discord" ? "Discord" : "Webhook"}</span>
            </label>
          ))
        )}
      </fieldset>

      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="enabled" defaultChecked={values.enabled === "on"} className="size-4" />
        Monitoring enabled
      </label>

      {state.formError && (
        <p role="alert" className="border-down/40 bg-down/10 rounded-md border px-3 py-2 text-sm">
          {state.formError}
        </p>
      )}

      <div className="flex gap-2">
        <Button type="submit" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
          {submitLabel}
        </Button>
        <Link href={cancelHref} className={buttonClass("ghost")}>
          Cancel
        </Link>
      </div>
    </form>
  );
}
