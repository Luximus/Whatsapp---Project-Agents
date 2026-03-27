const OTP_REGEX = /(?:codigo|code|otp)[^\d]{0,10}(\d{4,6})/i;
const FALLBACK_OTP_REGEX = /(\d{4,6})/;

export function extractOtp(text: string | null | undefined): string | null {
  if (!text) return null;
  const match = text.match(OTP_REGEX) ?? text.match(FALLBACK_OTP_REGEX);
  return match?.[1] ?? null;
}

export function normalizeE164(value: string | null | undefined): string | null {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

export function buildWaUrl(targetE164: string, message: string): string {
  const waNumber = targetE164.replace(/[^\d]/g, "");
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
}
