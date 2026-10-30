export function relativeTime(date: Date, now: Date): string {
  const seconds = Math.round((now.getTime() - date.getTime()) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 48) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function duration(ms: number): string {
  if (ms < 60_000) return `${Math.max(1, Math.round(ms / 1000))} s`;
  const minutes = Math.round(ms / 60_000);
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest ? `${hours} h ${rest} min` : `${hours} h`;
}

export function clockTime(date: Date): string {
  return date.toISOString().slice(11, 16) + " UTC";
}

export function ms(value: number | null): string {
  return value === null ? "—" : `${Math.round(value)} ms`;
}

const DATE_TIME = new Intl.DateTimeFormat("en", {
  month: "short",
  day: "numeric",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
  timeZone: "UTC",
});

/** "Oct 27, 14:05 UTC": server-rendered, so always UTC rather than the server's own zone. */
export function dateTime(date: Date): string {
  return `${DATE_TIME.format(date)} UTC`;
}

/** "https://example.com/shop" → "example.com/shop", for compact site listings. */
export function displayHost(url: string): string {
  return url.replace(/^https?:\/\//, "");
}
