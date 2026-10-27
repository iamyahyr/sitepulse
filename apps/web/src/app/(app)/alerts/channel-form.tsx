"use client";

import { Check, Copy, Loader2 } from "lucide-react";
import { useActionState, useState } from "react";
import { Button, Field, Input, Select } from "@/components/ui";
import { createChannelAction, type ChannelFormState } from "./actions";

const INITIAL: ChannelFormState = { values: { type: "discord", name: "", url: "" } };

function CopySecret({ secret }: { secret: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="flex items-center gap-2">
      <code className="bg-surface border-border min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 font-mono text-xs">{secret}</code>
      <Button
        type="button"
        variant="secondary"
        onClick={async () => {
          await navigator.clipboard.writeText(secret);
          setCopied(true);
        }}
      >
        {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
        {copied ? "Copied" : "Copy"}
      </Button>
    </div>
  );
}

export function ChannelForm() {
  const [state, formAction, pending] = useActionState(createChannelAction, INITIAL);
  const [type, setType] = useState(state.values.type);

  return (
    <div className="grid gap-5">
      {state.created && (
        <div role="status" className="border-up/40 bg-up/10 grid gap-3 rounded-lg border px-4 py-3 text-sm">
          <p className="font-medium">&ldquo;{state.created.name}&rdquo; is ready. Use &ldquo;Send test&rdquo; to try it.</p>
          {state.created.secret && (
            <>
              <p className="text-muted">
                Signing secret. Copy it now: it is stored encrypted and will not be shown again. Every request carries{" "}
                <code className="font-mono">X-SitePulse-Signature: t=…,v1=…</code>, the HMAC-SHA256 of{" "}
                <code className="font-mono">{"`${t}.${body}`"}</code> with this secret.
              </p>
              <CopySecret secret={state.created.secret} />
            </>
          )}
        </div>
      )}

      <form action={formAction} key={JSON.stringify(state.values)} className="grid gap-4">
        <div className="grid gap-4 sm:grid-cols-[10rem_1fr]">
          <Field id="type" label="Type">
            <Select id="type" name="type" defaultValue={state.values.type} onChange={(e) => setType(e.target.value)}>
              <option value="discord">Discord</option>
              <option value="webhook">Webhook</option>
            </Select>
          </Field>
          <Field id="channel-name" label="Name">
            <Input
              id="channel-name"
              name="name"
              defaultValue={state.values.name}
              placeholder={type === "discord" ? "#ops on Discord" : "n8n incident flow"}
              required
              maxLength={80}
            />
          </Field>
        </div>
        <Field
          id="channel-url"
          label={type === "discord" ? "Discord webhook URL" : "Webhook URL"}
          hint={
            type === "discord"
              ? "Server Settings → Integrations → Webhooks → Copy Webhook URL."
              : "Receives a signed JSON POST on every outage and recovery. Works with Slack, n8n, ntfy, Zapier…"
          }
        >
          <Input
            id="channel-url"
            name="url"
            type="url"
            defaultValue={state.values.url}
            placeholder={type === "discord" ? "https://discord.com/api/webhooks/…" : "https://example.com/hooks/sitepulse"}
            required
          />
        </Field>
        {state.error && (
          <p role="alert" className="text-down text-sm">
            {state.error}
          </p>
        )}
        <div>
          <Button type="submit" disabled={pending}>
            {pending && <Loader2 className="size-4 animate-spin" aria-hidden />}
            Add channel
          </Button>
        </div>
      </form>
    </div>
  );
}
