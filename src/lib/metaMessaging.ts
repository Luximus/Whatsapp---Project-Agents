import { env } from "../env.js";
import type { RichBlock } from "./richMessaging.js";

export type MetaMessagingChannel = "messenger" | "instagram";

export type MetaMessagingEvent = {
  channel: MetaMessagingChannel;
  senderId: string;
  recipientId: string;
  messageId: string;
  text: string;
  timestamp: number | null;
};

type RawMetaMessagingItem = {
  sender?: { id?: unknown };
  recipient?: { id?: unknown };
  timestamp?: unknown;
  message?: { mid?: unknown; text?: unknown; is_echo?: unknown; quick_reply?: { payload?: unknown }; attachments?: unknown[] };
  postback?: { mid?: unknown; title?: unknown; payload?: unknown };
};

type RawMetaMessagingBody = {
  object?: unknown;
  entry?: Array<{ id?: unknown; messaging?: RawMetaMessagingItem[] }>;
};

/**
 * Normaliza los webhooks de Messenger (`object=page`) e Instagram Messaging
 * (`object=instagram`) al mismo contrato. Se omiten echoes, receipts y eventos
 * sin texto para no disparar respuestas duplicadas o inventadas.
 */
export function flattenMetaMessagingEvents(body: unknown): MetaMessagingEvent[] {
  const payload = body as RawMetaMessagingBody;
  const channel: MetaMessagingChannel | null =
    payload?.object === "page" ? "messenger" : payload?.object === "instagram" ? "instagram" : null;
  if (!channel) return [];

  const events: MetaMessagingEvent[] = [];
  for (const entry of Array.isArray(payload?.entry) ? payload.entry : []) {
    for (const item of Array.isArray(entry?.messaging) ? entry.messaging : []) {
      const senderId = String(item?.sender?.id ?? "").trim();
      const recipientId = String(item?.recipient?.id ?? entry?.id ?? "").trim();
      const messageId = String(item?.message?.mid ?? item?.postback?.mid ?? "").trim();
      const isEcho = Boolean(item?.message?.is_echo);
      const text = String(
        item?.message?.quick_reply?.payload ?? item?.message?.text ?? item?.postback?.title ?? item?.postback?.payload ?? ""
      ).trim();
      if (!senderId || !recipientId || !text || isEcho) continue;

      events.push({
        channel,
        senderId,
        recipientId,
        messageId: messageId || `${channel}:${senderId}:${String(item?.timestamp ?? "unknown")}`,
        text,
        timestamp: Number.isFinite(Number(item?.timestamp)) ? Number(item.timestamp) : null
      });
    }
  }
  return events;
}

export async function sendMetaText(input: {
  channel: MetaMessagingChannel;
  recipientId: string;
  text: string;
}): Promise<{ messageId: string | null }> {
  const senderId = input.channel === "instagram" ? env.metaInstagramAccountId : env.metaPageId;
  if (!env.metaPageAccessToken || !senderId) {
    throw new Error(`meta_${input.channel}_not_configured`);
  }

  const response = await fetch(
    `https://graph.facebook.com/${encodeURIComponent(env.metaGraphVersion)}/${encodeURIComponent(senderId)}/messages`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${env.metaPageAccessToken}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({
        recipient: { id: input.recipientId },
        message: { text: input.text }
      })
    }
  );
  const payload = (await response.json().catch(() => ({}))) as {
    message_id?: unknown;
    error?: { code?: unknown; error_subcode?: unknown };
  };
  if (!response.ok) {
    const code = payload?.error?.code ?? response.status;
    const subcode = payload?.error?.error_subcode;
    throw new Error(`meta_${input.channel}_send_failed:${code}${subcode ? `:${subcode}` : ""}`);
  }
  return { messageId: String(payload?.message_id ?? "").trim() || null };
}

async function sendMetaPayload(channel: MetaMessagingChannel, recipientId: string, message: Record<string, unknown>, senderAction?: string) {
  const senderId = channel === "instagram" ? env.metaInstagramAccountId : env.metaPageId;
  if (!env.metaPageAccessToken || !senderId) throw new Error(`meta_${channel}_not_configured`);
  const response = await fetch(`https://graph.facebook.com/${encodeURIComponent(env.metaGraphVersion)}/${encodeURIComponent(senderId)}/messages`, {
    method: "POST",
    headers: { authorization: `Bearer ${env.metaPageAccessToken}`, "content-type": "application/json" },
    body: JSON.stringify({ recipient: { id: recipientId }, ...(senderAction ? { sender_action: senderAction } : { message }) })
  });
  const payload = await response.json().catch(() => ({})) as any;
  if (!response.ok) throw new Error(`meta_${channel}_send_failed:${payload?.error?.code ?? response.status}`);
  return { messageId: String(payload?.message_id ?? "").trim() || null };
}

export async function sendMetaSenderAction(input: { channel: MetaMessagingChannel; recipientId: string; action: "mark_seen" | "typing_on" | "typing_off" }) {
  return sendMetaPayload(input.channel, input.recipientId, {}, input.action);
}

export async function sendMetaRich(input: { channel: MetaMessagingChannel; recipientId: string; block: RichBlock }) {
  const { block } = input;
  if (block.kind === "buttons") {
    return sendMetaPayload(input.channel, input.recipientId, {
      text: block.body,
      quick_replies: block.options.slice(0, 13).map((option) => ({ content_type: "text", title: option.title, payload: option.id }))
    });
  }
  if (block.kind === "image") {
    return sendMetaPayload(input.channel, input.recipientId, { attachment: { type: "image", payload: { url: block.url, is_reusable: true } } });
  }
  if (block.kind === "link") {
    return sendMetaPayload(input.channel, input.recipientId, { attachment: { type: "template", payload: { template_type: "button", text: block.body, buttons: [{ type: "web_url", url: block.url, title: block.label }] } } });
  }
  if (block.kind === "card") {
    const buttons = [
      ...(block.url ? [{ type: "web_url", url: block.url, title: "Ver más" }] : []),
      ...(block.buttons ?? []).slice(0, 3).map((button) => button.url ? ({ type: "web_url", url: button.url, title: button.title }) : ({ type: "postback", payload: button.id, title: button.title }))
    ].slice(0, 3);
    return sendMetaPayload(input.channel, input.recipientId, { attachment: { type: "template", payload: { template_type: "generic", elements: [{ title: block.title, ...(block.subtitle ? { subtitle: block.subtitle } : {}), ...(block.imageUrl ? { image_url: block.imageUrl } : {}), ...(buttons.length ? { buttons } : {}) }] } } });
  }
  const options = block.sections.flatMap((section) => section.rows).slice(0, 13);
  return sendMetaPayload(input.channel, input.recipientId, { text: block.body, quick_replies: options.map((option) => ({ content_type: "text", title: option.title.slice(0, 20), payload: option.id })) });
}
