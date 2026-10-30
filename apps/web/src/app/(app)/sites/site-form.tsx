"use client";

import { Loader2, Plus, X } from "lucide-react";
import Link from "next/link";
import { useActionState, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Button, Field, Input, Select, buttonClass } from "@/components/ui";
import { INTERVAL_OPTIONS, TIMEOUT_OPTIONS, type SiteFormState, type SiteFormValues } from "@/lib/site-options";
import { ChannelForm, type CreatedChannel } from "../alerts/channel-form";

type Action = (state: SiteFormState, formData: FormData) => Promise<SiteFormState>;
type Channel = { id: string; name: string; type: "discord" | "webhook" };

/**
 * Creates an alert channel without leaving the site form, so nothing typed so
 * far is lost. The dialog is portalled to <body>: its own <form> must not nest
 * inside the site form. It only exists while open, so each opening starts clean.
 */
function NewChannelDialog({ onCreated }: { onCreated: (channel: CreatedChannel) => void }) {
  const [open, setOpen] = useState(false);
  const [showDone, setShowDone] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  const close = () => dialog.current?.close();

  return (
    <>
      <Button
        type="button"
        variant="secondary"
        onClick={() => {
          setShowDone(false);
          setOpen(true);
        }}
      >
        <Plus className="size-4" aria-hidden />
        New channel
      </Button>
      {open &&
        createPortal(
          <dialog
            ref={(el) => {
              dialog.current = el;
              if (el && !el.open) el.showModal();
            }}
            onClose={() => setOpen(false)}
            aria-labelledby="new-channel-title"
            className="border-border bg-background text-foreground m-auto w-[calc(100%-2rem)] max-w-lg rounded-lg border p-0 shadow-xl backdrop:bg-black/50"
          >
            <div className="border-border flex items-center justify-between border-b px-5 py-3">
              <h2 id="new-channel-title" className="text-sm font-semibold">
                New alert channel
              </h2>
              <button type="button" onClick={close} className={buttonClass("ghost", "h-8 px-2")} aria-label="Close">
                <X className="size-4" aria-hidden />
              </button>
            </div>
            <div className="grid gap-4 p-5">
              <ChannelForm
                onCreated={(channel) => {
                  onCreated(channel);
                  // A webhook's signing secret is shown only once: keep the dialog open to copy it.
                  if (channel.secret) setShowDone(true);
                  else close();
                }}
              />
              {showDone && (
                <div className="flex justify-end">
                  <Button type="button" onClick={close}>
                    Done
                  </Button>
                </div>
              )}
            </div>
          </dialog>,
          document.body,
        )}
    </>
  );
}

export function SiteForm({
  action,
  initial,
  minIntervalSec,
  submitLabel,
  cancelHref,
  channels,
}: {
  channels: Channel[];
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

  // Channels created from the dialog start ticked. The server may also send them
  // back in `channels` once the page revalidates, hence the de-duplication.
  const [createdChannels, setCreatedChannels] = useState<Channel[]>([]);
  const createdIds = new Set(createdChannels.map((c) => c.id));
  const allChannels = [...channels.filter((c) => !createdIds.has(c.id)), ...createdChannels];

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
        <legend className="mb-1.5 text-sm font-medium">Alert channels (optional)</legend>
        {allChannels.length === 0 ? (
          <p className="text-muted text-xs">
            No channels yet. Add Discord or a webhook to be notified when this site goes down and recovers, or skip it:
            incidents still show up here, and you can add channels later.
          </p>
        ) : (
          allChannels.map((channel) => (
            <label key={channel.id} className="flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                name="channelIds"
                value={channel.id}
                defaultChecked={values.channelIds.includes(channel.id) || createdIds.has(channel.id)}
                className="size-4"
              />
              {channel.name}
              <span className="text-muted text-xs">{channel.type === "discord" ? "Discord" : "Webhook"}</span>
            </label>
          ))
        )}
        <div className="mt-1">
          <NewChannelDialog onCreated={(channel) => setCreatedChannels((list) => [...list, channel])} />
        </div>
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

      <div className="grid gap-2 sm:flex">
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
