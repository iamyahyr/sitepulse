import "server-only";
import { checkUrl, parseExpectedStatus, type UrlRejection } from "@sitepulse/core";
import { z } from "zod";
import { INTERVAL_OPTIONS, TIMEOUT_OPTIONS, type SiteFormValues } from "@/lib/site-options";
import { env } from "@/server/env";

const URL_MESSAGES: Record<UrlRejection, string> = {
  INVALID_URL: "Enter a full URL, e.g. https://example.com",
  UNSUPPORTED_PROTOCOL: "Only http:// and https:// URLs can be monitored.",
  CREDENTIALS_IN_URL: "Remove the username/password from the URL.",
  BLOCKED_HOSTNAME: "Local and internal hostnames cannot be monitored.",
  BLOCKED_ADDRESS: "Private, loopback and reserved IP addresses cannot be monitored.",
};

export type SiteInput = {
  name: string;
  url: string;
  client: string | null;
  intervalSec: number;
  timeoutMs: number;
  expectedStatus: string;
  enabled: boolean;
};

function schema() {
  const { MIN_INTERVAL_SEC, ALLOW_PRIVATE_CIDRS } = env();
  const intervals: number[] = INTERVAL_OPTIONS.map((o) => o.value).filter((v) => v >= MIN_INTERVAL_SEC);
  const timeouts: number[] = TIMEOUT_OPTIONS.map((o) => o.value);

  return z.object({
    name: z.string().trim().min(1, "Give the site a name.").max(80, "Keep it under 80 characters."),
    url: z
      .string()
      .trim()
      .max(2048, "URL is too long.")
      .transform((raw, ctx) => {
        // Literal IPs and obvious internal names are rejected here for a clear
        // message; hostnames are re-validated after DNS on every probe.
        const result = checkUrl(raw, { allowPrivateCidrs: ALLOW_PRIVATE_CIDRS });
        if (!result.ok) {
          ctx.addIssue({ code: "custom", message: URL_MESSAGES[result.reason] });
          return z.NEVER;
        }
        result.url.hash = "";
        return result.url.href;
      }),
    client: z
      .string()
      .trim()
      .max(80, "Keep it under 80 characters.")
      .transform((v) => v || null),
    intervalSec: z.coerce.number().refine((v) => intervals.includes(v), "Pick one of the listed intervals."),
    timeoutMs: z.coerce.number().refine((v) => timeouts.includes(v), "Pick one of the listed timeouts."),
    expectedStatus: z
      .string()
      .trim()
      .refine((v) => parseExpectedStatus(v) !== null, "Use codes and ranges like 200-399 or 200,204,301."),
    enabled: z.string().transform((v) => v === "on"),
  });
}

export function readSiteForm(formData: FormData): SiteFormValues {
  const get = (key: string) => {
    const value = formData.get(key);
    return typeof value === "string" ? value : "";
  };
  return {
    name: get("name"),
    url: get("url"),
    client: get("client"),
    intervalSec: get("intervalSec"),
    timeoutMs: get("timeoutMs"),
    expectedStatus: get("expectedStatus"),
    enabled: get("enabled"),
  };
}

export function parseSiteInput(
  values: SiteFormValues,
): { ok: true; data: SiteInput } | { ok: false; fieldErrors: Partial<Record<keyof SiteFormValues, string>> } {
  const parsed = schema().safeParse(values);
  if (parsed.success) return { ok: true, data: parsed.data };

  const fieldErrors: Partial<Record<keyof SiteFormValues, string>> = {};
  for (const issue of parsed.error.issues) {
    const key = issue.path[0] as keyof SiteFormValues;
    fieldErrors[key] ??= issue.message;
  }
  return { ok: false, fieldErrors };
}
