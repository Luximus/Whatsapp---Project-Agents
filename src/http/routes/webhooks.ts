import type { FastifyPluginAsync } from "fastify";
import { env } from "../../config/env.js";
import { transcribeAudioWithOpenAI } from "../../infrastructure/ai/transcription.js";
import {
  trackInboundMessage,
  trackOpenAIFailure,
  trackOperationalError
} from "../../domain/reporting/tracker.js";
import {
  downloadWhatsappMedia,
  markWhatsappMessageAsRead,
  sendWhatsappTypingIndicator
} from "../../infrastructure/messaging/whatsappApi.js";
import { normalizeE164 } from "../../domain/whatsapp/otpExtractor.js";
import {
  enqueueInbound,
  drainBuffer,
  processBufferedInbound,
  shouldApplyProbability,
  safeReply,
  type InboundBuffer
} from "../../application/whatsapp/handleInbound.js";
import { handleOtpMessage } from "../../application/whatsapp/handleOtp.js";
import type { WebhookMessage, WebhookStatus } from "../../domain/whatsapp/types.js";

function flattenWebhookMessages(body: any) {
  const messages: WebhookMessage[] = [];
  const statuses: WebhookStatus[] = [];

  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const batchMessages = Array.isArray(value?.messages) ? value.messages : [];
      const batchStatuses = Array.isArray(value?.statuses) ? value.statuses : [];
      messages.push(...batchMessages);
      statuses.push(...batchStatuses);
    }
  }

  return { messages, statuses };
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  const pendingInboundByPhone: InboundBuffer = new Map();

  const markReadAndShowTyping = async (phoneE164: string, incomingMessageId: string | null) => {
    if (!incomingMessageId) return;

    if (shouldApplyProbability(env.whatsappMarkAsReadProbability)) {
      try {
        await markWhatsappMessageAsRead(incomingMessageId);
      } catch (err) {
        trackOperationalError();
        fastify.log.warn(
          { err, incomingMessageId, from: phoneE164 },
          "WhatsApp mark-as-read failed"
        );
      }
    }

    if (shouldApplyProbability(env.whatsappTypingIndicatorProbability)) {
      try {
        await sendWhatsappTypingIndicator(incomingMessageId);
      } catch (err) {
        trackOperationalError();
        fastify.log.warn(
          { err, incomingMessageId, from: phoneE164 },
          "WhatsApp typing indicator failed"
        );
      }
    }
  };

  fastify.addHook("onClose", async () => {
    drainBuffer(pendingInboundByPhone);
  });

  fastify.get("/api/webhooks/whatsapp", async (request, reply) => {
    const mode = (request.query as any)?.["hub.mode"];
    const token = (request.query as any)?.["hub.verify_token"];
    const challenge = (request.query as any)?.["hub.challenge"];

    if (mode === "subscribe" && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      reply.code(200).send(challenge ?? "");
      return;
    }

    reply.code(403).send("Invalid token");
  });

  fastify.post("/api/webhooks/whatsapp", async (request) => {
    const body = request.body as any;
    const { messages, statuses } = flattenWebhookMessages(body);

    for (const status of statuses) {
      if (status.status === "failed") {
        fastify.log.warn(
          {
            waMessageId: status.id ?? null,
            waStatus: status.status ?? null,
            recipientId: status.recipient_id ?? null,
            errors: status.errors ?? []
          },
          "WhatsApp delivery failed"
        );
      } else {
        fastify.log.info(
          {
            waMessageId: status.id ?? null,
            waStatus: status.status ?? null,
            recipientId: status.recipient_id ?? null
          },
          "WhatsApp delivery status"
        );
      }
    }

    if (!messages.length) return { ok: true };

    for (const msg of messages) {
      const incomingMessageId = String(msg.id ?? "").trim();
      const from = msg.from ? normalizeE164(msg.from) : null;
      const messageType = String(msg.type ?? "").trim().toLowerCase();
      if (!from) continue;

      const isReaction =
        messageType === "reaction" || Boolean(String(msg.reaction?.emoji ?? "").trim());
      if (isReaction) {
        fastify.log.info(
          {
            from,
            incomingMessageId: incomingMessageId || null,
            reactionToMessageId: String(msg.reaction?.message_id ?? "").trim() || null,
            reactionEmoji: String(msg.reaction?.emoji ?? "").trim() || null
          },
          "Ignoring WhatsApp reaction event"
        );
        continue;
      }

      await markReadAndShowTyping(from, incomingMessageId || null);

      let text = String(msg.text?.body ?? "").trim();
      const isAudioInput = messageType === "audio" || (!!msg.audio?.id && !text);
      trackInboundMessage({
        fromE164: from,
        messageType: isAudioInput ? "audio" : "text"
      });

      if (isAudioInput && msg.audio?.id) {
        try {
          const media = await downloadWhatsappMedia(msg.audio.id);
          text = await transcribeAudioWithOpenAI({
            data: media.data,
            mimeType: media.mimeType,
            filename: media.filename
          });
          text = text.trim();
        } catch (err) {
          fastify.log.warn(
            { err, from, incomingMessageId, mediaId: msg.audio.id ?? null },
            "Audio transcription failed"
          );
          trackOpenAIFailure();
          trackOperationalError();
          await safeReply(
            from,
            "Recibi tu nota de voz, pero no pude transcribirla. Puedes reenviarla o escribir tu mensaje en texto.",
            incomingMessageId,
            fastify.log
          );
          continue;
        }
      }

      if (!text) continue;

      const otpResult = await handleOtpMessage(
        { from, text, incomingMessageId: incomingMessageId || null },
        fastify.log
      );
      if (otpResult.handled) {
        pendingInboundByPhone.delete(from);
        continue;
      }

      enqueueInbound(
        pendingInboundByPhone,
        { phoneE164: from, text, incomingMessageId: incomingMessageId || null },
        env.whatsappInboundDebounceMs,
        (phoneE164, pending) => {
          const joinedText = pending.chunks
            .map((c) => String(c ?? "").trim())
            .filter(Boolean)
            .join("\n")
            .trim();
          if (!joinedText) return;

          void processBufferedInbound(
            phoneE164,
            joinedText,
            pending.lastIncomingMessageId,
            fastify.log
          ).catch((err) => {
            trackOperationalError();
            fastify.log.error({ err, from: phoneE164 }, "Buffered inbound processing failed");
          });
        }
      );
    }

    return { ok: true };
  });
};
