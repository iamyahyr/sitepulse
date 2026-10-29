"use client";

import { Check, Copy, Link2, Loader2, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { PrintButton } from "@/components/print-button";
import { Button } from "@/components/ui";
import { dateTime } from "@/lib/format";
import { createShareAction, revokeShareAction, type ShareResult } from "./actions";

export function SharePanel({
  client,
  month,
  shares,
}: {
  client: string | null;
  month: string;
  shares: { id: string; createdAt: Date }[];
}) {
  const [creating, startCreate] = useTransition();
  const [revoking, startRevoke] = useTransition();
  const [result, setResult] = useState<ShareResult | null>(null);
  const [copied, setCopied] = useState(false);

  return (
    <div className="space-y-3 print:hidden">
      <div className="flex flex-wrap items-center gap-2">
        <Button
          type="button"
          disabled={creating}
          onClick={() =>
            startCreate(async () => {
              setCopied(false);
              setResult(await createShareAction(client, month));
            })
          }
        >
          {creating ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Link2 className="size-4" aria-hidden />}
          Share link
        </Button>
        <PrintButton />
        {result?.error && (
          <span role="status" className="text-down text-sm">
            {result.error}
          </span>
        )}
      </div>

      {result?.url && (
        <div className="border-border bg-surface-muted space-y-2 rounded-lg border p-3 text-sm">
          <p className="text-muted">
            Anyone with this link can view this report, without signing in. Copy it now: it is not stored and will not be
            shown again.
          </p>
          <div className="flex items-center gap-2">
            <code className="bg-surface border-border min-w-0 flex-1 truncate rounded-md border px-2 py-1.5 font-mono text-xs">
              {result.url}
            </code>
            <Button
              type="button"
              variant="secondary"
              onClick={async () => {
                await navigator.clipboard.writeText(result.url!);
                setCopied(true);
              }}
            >
              {copied ? <Check className="size-4" aria-hidden /> : <Copy className="size-4" aria-hidden />}
              {copied ? "Copied" : "Copy"}
            </Button>
          </div>
        </div>
      )}

      {shares.length > 0 && (
        <ul className="text-muted space-y-1 text-sm">
          {shares.map((share) => (
            <li key={share.id} className="flex items-center gap-2">
              <Link2 className="size-3.5" aria-hidden />
              Link created {dateTime(share.createdAt)}
              <Button
                type="button"
                variant="ghost"
                className="h-7 px-2 text-xs"
                disabled={revoking}
                onClick={() => {
                  if (!confirm("Revoke this link? Anyone using it will get a 404.")) return;
                  startRevoke(() => revokeShareAction(share.id));
                }}
              >
                <Trash2 className="size-3.5" aria-hidden />
                Revoke
              </Button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
