"use client";

import { Loader2, Send, Trash2 } from "lucide-react";
import { useState, useTransition } from "react";
import { Button } from "@/components/ui";
import { deleteChannelAction, testChannelAction } from "./actions";

export function ChannelActions({ id, name }: { id: string; name: string }) {
  const [testing, startTest] = useTransition();
  const [deleting, startDelete] = useTransition();
  const [result, setResult] = useState<{ ok: boolean; message: string } | null>(null);

  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      {result && (
        <span role="status" className={`text-xs ${result.ok ? "text-up" : "text-down"}`}>
          {result.message}
        </span>
      )}
      <Button
        type="button"
        variant="secondary"
        disabled={testing}
        onClick={() => startTest(async () => setResult(await testChannelAction(id)))}
      >
        {testing ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Send className="size-4" aria-hidden />}
        Send test
      </Button>
      <Button
        type="button"
        variant="ghost"
        disabled={deleting}
        aria-label={`Delete ${name}`}
        onClick={() => {
          if (!confirm(`Delete "${name}"? Sites will stop alerting through it.`)) return;
          startDelete(() => deleteChannelAction(id));
        }}
      >
        <Trash2 className="size-4" aria-hidden />
      </Button>
    </div>
  );
}
