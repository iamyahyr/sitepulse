import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/**
 * Encryption at rest for alert channel configs (webhook URLs embed their own
 * credentials) and HMAC signing for outgoing webhooks.
 *
 * Format: "v1.<iv>.<tag>.<ciphertext>", base64url. AES-256-GCM authenticates
 * the ciphertext, so tampering with a stored value fails to decrypt instead
 * of yielding garbage.
 */

const VERSION = "v1";

/** Any sufficiently long operator secret is stretched to a 256-bit key. */
function deriveKey(secret: string): Buffer {
  if (secret.length < 32) throw new Error("SITEPULSE_SECRET_KEY must be at least 32 characters");
  return createHash("sha256").update(`sitepulse:channel-config:${secret}`).digest();
}

export function encryptJson(secret: string, value: unknown): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", deriveKey(secret), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return [VERSION, iv, cipher.getAuthTag(), ciphertext].map((p) => (typeof p === "string" ? p : p.toString("base64url"))).join(".");
}

export function decryptJson<T>(secret: string, payload: string): T {
  const [version, iv, tag, ciphertext] = payload.split(".");
  if (version !== VERSION || !iv || !tag || !ciphertext) throw new Error("Unsupported encrypted payload");
  const decipher = createDecipheriv("aes-256-gcm", deriveKey(secret), Buffer.from(iv, "base64url"));
  decipher.setAuthTag(Buffer.from(tag, "base64url"));
  const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, "base64url")), decipher.final()]);
  return JSON.parse(plaintext.toString("utf8")) as T;
}

export function generateWebhookSecret(): string {
  return `whsec_${randomBytes(24).toString("base64url")}`;
}

/**
 * Stripe-style signature: `t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>">`.
 * The timestamp is signed too, so receivers can reject replays.
 */
export function signWebhook(secret: string, body: string, timestamp = Math.floor(Date.now() / 1000)): string {
  const digest = createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex");
  return `t=${timestamp},v1=${digest}`;
}

/** Reference verifier for receivers (also documented in the README). */
export function verifyWebhook(
  secret: string,
  body: string,
  header: string,
  { toleranceSec = 300, now = Math.floor(Date.now() / 1000) } = {},
): boolean {
  const parts = Object.fromEntries(header.split(",").map((kv) => kv.split("=", 2) as [string, string]));
  const timestamp = Number(parts.t);
  if (!Number.isInteger(timestamp) || !parts.v1 || Math.abs(now - timestamp) > toleranceSec) return false;
  const expected = Buffer.from(signWebhook(secret, body, timestamp).split("v1=")[1]!, "hex");
  const given = Buffer.from(parts.v1, "hex");
  return given.length === expected.length && timingSafeEqual(given, expected);
}
