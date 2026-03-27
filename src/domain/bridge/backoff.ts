import { env } from "../../config/env.js";

export function nextRetryAt(attempts: number): Date {
  const base = env.BRIDGE_EVENT_RETRY_BASE_SECONDS;
  const seconds = Math.min(base * Math.max(1, 2 ** (attempts - 1)), 60 * 60);
  return new Date(Date.now() + seconds * 1000);
}

export function sessionRetentionMs(): number {
  const ttlMs = env.BRIDGE_OTP_TTL_SECONDS * 1000;
  return Math.max(ttlMs * 3, 24 * 60 * 60 * 1000);
}
