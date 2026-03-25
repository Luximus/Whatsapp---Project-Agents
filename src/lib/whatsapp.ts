import { env } from "../env.js";

const OTP_REGEX = /(?:codigo|code|otp)[^\d]{0,10}(\d{4,6})/i;
const FALLBACK_OTP_REGEX = /(\d{4,6})/;
const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/i;

export type SendWhatsappTextOptions = {
  replyToMessageId?: string | null;
  previewUrl?: boolean;
};

export function extractOtp(text: string | null | undefined) {
  if (!text) return null;
  const match = text.match(OTP_REGEX) ?? text.match(FALLBACK_OTP_REGEX);
  return match?.[1] ?? null;
}

export function normalizeE164(value: string | null | undefined) {
  if (!value) return null;
  const trimmed = String(value).trim();
  if (!trimmed) return null;
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;
  return `+${digits}`;
}

export function toWaMeNumber(e164: string) {
  return e164.replace(/[^\d]/g, "");
}

export function buildWaUrl(targetE164: string, message: string) {
  const waNumber = toWaMeNumber(targetE164);
  return `https://wa.me/${waNumber}?text=${encodeURIComponent(message)}`;
}

async function sendWhatsappRequest(payload: Record<string, unknown>) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("whatsapp_not_configured");
  }
  const url = `https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => "");
  let parsed: any = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!res.ok) {
    throw Object.assign(new Error("whatsapp_send_failed"), {
      statusCode: res.status,
      details: parsed ?? raw
    });
  }

  return parsed;
}

function normalizeMessageId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function shouldEnablePreview(text: string, explicit?: boolean) {
  if (typeof explicit === "boolean") return explicit;
  return URL_REGEX.test(text);
}

export async function sendWhatsappText(
  toE164: string,
  text: string,
  options: SendWhatsappTextOptions = {}
) {
  const to = toWaMeNumber(toE164);
  const body = String(text ?? "").trim();
  if (!body) {
    throw new Error("whatsapp_text_required");
  }

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "text",
    text: {
      body,
      preview_url: shouldEnablePreview(body, options.previewUrl)
    }
  };

  const replyToMessageId = normalizeMessageId(options.replyToMessageId);
  if (replyToMessageId) {
    payload.context = { message_id: replyToMessageId };
  }

  return sendWhatsappRequest(payload);
}

export async function sendWhatsappTypingIndicator(messageId: string) {
  const normalized = String(messageId ?? "").trim();
  if (!normalized) {
    throw new Error("whatsapp_message_id_required");
  }

  return sendWhatsappRequest({
    messaging_product: "whatsapp",
    status: "read",
    message_id: normalized,
    typing_indicator: {
      type: "text"
    }
  });
}
