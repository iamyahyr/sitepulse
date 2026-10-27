"use client";

import { Trash2 } from "lucide-react";
import { useTransition } from "react";
import { Button } from "@/components/ui";
import { deleteSiteAction } from "./actions";

export function DeleteSiteButton({ id, name }: { id: string; name: string }) {
  const [pending, startTransition] = useTransition();

  return (
    <Button
      type="button"
      variant="danger"
      disabled={pending}
      onClick={() => {
        if (!confirm(`Delete "${name}" and all of its check history? This cannot be undone.`)) return;
        startTransition(() => deleteSiteAction(id));
      }}
    >
      <Trash2 className="size-4" aria-hidden />
      Delete site
    </Button>
  );
}
