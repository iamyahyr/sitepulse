/** Form options shared by the client form and server-side validation. */

export const INTERVAL_OPTIONS = [
  { value: 60, label: "Every minute" },
  { value: 300, label: "Every 5 minutes" },
  { value: 900, label: "Every 15 minutes" },
  { value: 1800, label: "Every 30 minutes" },
  { value: 3600, label: "Every hour" },
] as const;

export const TIMEOUT_OPTIONS = [
  { value: 5_000, label: "5 seconds" },
  { value: 10_000, label: "10 seconds" },
  { value: 15_000, label: "15 seconds" },
  { value: 30_000, label: "30 seconds" },
] as const;

export const SITE_DEFAULTS = {
  name: "",
  url: "https://",
  client: "",
  intervalSec: "300",
  timeoutMs: "10000",
  expectedStatus: "200-399",
  enabled: "on",
  channelIds: [] as string[],
};

export type SiteFormValues = typeof SITE_DEFAULTS;

export type SiteFormState = {
  values: SiteFormValues;
  fieldErrors?: Partial<Record<keyof SiteFormValues, string>>;
  formError?: string;
};
