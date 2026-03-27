import { env } from "../../config/env.js";
import { WHATSAPP_GRAPH_API_VERSION } from "../../config/constants.js";
import { HttpError } from "../../errors/HttpError.js";

export type SendWhatsappTextOptions = {
  replyToMessageId?: string | null;
  previewUrl?: boolean;
};

export type SendWhatsappAudioOptions = {
  replyToMessageId?: string | null;
  asVoiceMessage?: boolean;
};

export type WhatsappMediaFile = {
  mediaId: string;
  mimeType: string | null;
  data: Buffer;
  filename: string;
};

const URL_REGEX = /\bhttps?:\/\/[^\s<>"']+/i;

async function sendWhatsappRequest(payload: Record<string, unknown>) {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("whatsapp_not_configured");
  }
  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${env.WHATSAPP_PHONE_NUMBER_ID}/messages`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.WHATSAPP_ACCESS_TOKEN}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await res.text().catch(() => "");
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!res.ok) {
    throw new HttpError(res.status, "whatsapp_send_failed", parsed ?? raw);
  }

  return parsed;
}

function requireWhatsappCredentials() {
  if (!env.WHATSAPP_ACCESS_TOKEN || !env.WHATSAPP_PHONE_NUMBER_ID) {
    throw new Error("whatsapp_not_configured");
  }
  return {
    accessToken: env.WHATSAPP_ACCESS_TOKEN,
    phoneNumberId: env.WHATSAPP_PHONE_NUMBER_ID
  };
}

function normalizeMessageId(value: string | null | undefined) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function shouldEnablePreview(text: string, explicit?: boolean) {
  if (typeof explicit === "boolean") return explicit;
  return URL_REGEX.test(text);
}

export function toWaMeNumber(e164: string) {
  return e164.replace(/[^\d]/g, "");
}

export async function sendWhatsappText(
  toE164: string,
  text: string,
  options: SendWhatsappTextOptions = {}
) {
  const to = toWaMeNumber(toE164);
  const body = String(text ?? "").trim();
  if (!body) throw new Error("whatsapp_text_required");

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

export async function uploadWhatsappMedia(input: {
  data: Buffer;
  mimeType: string;
  filename: string;
}): Promise<string> {
  const { accessToken, phoneNumberId } = requireWhatsappCredentials();
  const mimeType = String(input.mimeType ?? "").trim() || "audio/mpeg";
  const filename = String(input.filename ?? "").trim() || "audio.mp3";

  const form = new FormData();
  form.set("messaging_product", "whatsapp");
  form.set("type", mimeType);
  form.set("file", new Blob([input.data], { type: mimeType }), filename);

  const url = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${phoneNumberId}/media`;
  const response = await fetch(url, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}` },
    body: form
  });

  const raw = await response.text().catch(() => "");
  let parsed: unknown = null;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = raw;
    }
  }

  if (!response.ok) {
    throw new HttpError(response.status, "whatsapp_media_upload_failed", parsed ?? raw);
  }

  const mediaId = String((parsed as any)?.id ?? "").trim();
  if (!mediaId) throw new Error("whatsapp_media_upload_missing_id");
  return mediaId;
}

export async function sendWhatsappAudio(
  toE164: string,
  input: { mediaId?: string | null; data?: Buffer; mimeType?: string | null; filename?: string | null },
  options: SendWhatsappAudioOptions = {}
) {
  const to = toWaMeNumber(toE164);
  let mediaId = String(input.mediaId ?? "").trim();

  if (!mediaId) {
    if (!input.data?.length) throw new Error("whatsapp_audio_data_required");
    mediaId = await uploadWhatsappMedia({
      data: input.data,
      mimeType: String(input.mimeType ?? "").trim() || "audio/mpeg",
      filename: String(input.filename ?? "").trim() || "reply.mp3"
    });
  }

  const payload: Record<string, unknown> = {
    messaging_product: "whatsapp",
    to,
    type: "audio",
    audio: {
      id: mediaId,
      ...(options.asVoiceMessage ? { voice: true } : {})
    }
  };

  const replyToMessageId = normalizeMessageId(options.replyToMessageId);
  if (replyToMessageId) {
    payload.context = { message_id: replyToMessageId };
  }

  return sendWhatsappRequest(payload);
}

export async function downloadWhatsappMedia(mediaId: string): Promise<WhatsappMediaFile> {
  const { accessToken } = requireWhatsappCredentials();
  const normalizedMediaId = String(mediaId ?? "").trim();
  if (!normalizedMediaId) throw new Error("whatsapp_media_id_required");

  const metadataUrl = `https://graph.facebook.com/${WHATSAPP_GRAPH_API_VERSION}/${encodeURIComponent(normalizedMediaId)}`;
  const metadataResponse = await fetch(metadataUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` }
  });

  const metadataRaw = await metadataResponse.text().catch(() => "");
  let metadata: unknown = null;
  if (metadataRaw) {
    try {
      metadata = JSON.parse(metadataRaw);
    } catch {
      metadata = metadataRaw;
    }
  }

  if (!metadataResponse.ok) {
    throw new HttpError(metadataResponse.status, "whatsapp_media_metadata_failed", metadata ?? metadataRaw);
  }

  const mediaUrl = String((metadata as any)?.url ?? "").trim();
  if (!mediaUrl) throw new Error("whatsapp_media_url_missing");

  const binaryResponse = await fetch(mediaUrl, {
    method: "GET",
    headers: { authorization: `Bearer ${accessToken}` }
  });

  const binary = await binaryResponse.arrayBuffer().catch(() => new ArrayBuffer(0));
  if (!binaryResponse.ok) {
    throw new HttpError(binaryResponse.status, "whatsapp_media_download_failed", Buffer.from(binary).toString("utf8"));
  }

  const mimeType = String((metadata as any)?.mime_type ?? "").trim() || null;
  const extension =
    mimeType === "audio/ogg" ? "ogg"
    : mimeType === "audio/wav" ? "wav"
    : mimeType === "audio/mp4" ? "m4a"
    : "mp3";

  return {
    mediaId: normalizedMediaId,
    mimeType,
    data: Buffer.from(binary),
    filename: `incoming-${normalizedMediaId}.${extension}`
  };
}

export async function sendWhatsappTypingIndicator(messageId: string) {
  const normalized = String(messageId ?? "").trim();
  if (!normalized) throw new Error("whatsapp_message_id_required");

  return sendWhatsappRequest({
    messaging_product: "whatsapp",
    status: "read",
    message_id: normalized,
    typing_indicator: { type: "text" }
  });
}

export async function markWhatsappMessageAsRead(messageId: string) {
  const normalized = String(messageId ?? "").trim();
  if (!normalized) throw new Error("whatsapp_message_id_required");

  return sendWhatsappRequest({
    messaging_product: "whatsapp",
    status: "read",
    message_id: normalized
  });
}
