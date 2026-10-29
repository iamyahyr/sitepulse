"use client";

import { Printer } from "lucide-react";
import { Button } from "@/components/ui";

/** The browser's own "Save as PDF": no headless Chrome on the server. */
export function PrintButton() {
  return (
    <Button type="button" variant="secondary" onClick={() => window.print()}>
      <Printer className="size-4" aria-hidden />
      Download PDF
    </Button>
  );
}
