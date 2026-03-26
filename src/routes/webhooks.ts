import type { FastifyPluginAsync } from "fastify";
import { consumeBridgeOtp, dispatchDueBridgeEvents } from "../lib/bridge.js";
import { env } from "../env.js";
import { isElevenLabsConfigured, synthesizeSpeechWithElevenLabs } from "../lib/elevenlabs.js";
import { transcribeAudioWithOpenAI } from "../lib/openaiAudio.js";
import { handleProjectAgentMessage } from "../lib/projectAgent.js";
import {
  trackAgentReplyGenerated,
  trackInboundMessage,
  trackOpenAIFailure,
  trackOperationalError,
  trackOtpMessage,
  trackOutboundMessage
} from "../lib/reporting.js";
import {
  downloadWhatsappMedia,
  extractOtp,
  markWhatsappMessageAsRead,
  normalizeE164,
  sendWhatsappAudio,
  sendWhatsappText,
  sendWhatsappTypingIndicator
} from "../lib/whatsapp.js";

type WebhookMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  reaction?: {
    emoji?: string;
    message_id?: string;
  };
  audio?: {
    id?: string;
    mime_type?: string;
    voice?: boolean;
  };
};

type WebhookStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

const MAX_TEXT_REPLY_CHARS = 250;
const USER_MESSAGE_DEBOUNCE_MS = env.whatsappInboundDebounceMs;

type PendingInbound = {
  chunks: string[];
  lastIncomingMessageId: string | null;
  timer: NodeJS.Timeout | null;
};

function clampProbability(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

function shouldApplyProbability(probabilityPercent: number) {
  const probability = clampProbability(probabilityPercent);
  if (probability <= 0) return false;
  if (probability >= 100) return true;
  return Math.random() * 100 < probability;
}

function toTextChannelReply(input: string, maxChars = MAX_TEXT_REPLY_CHARS) {
  const normalized = String(input ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 3) return normalized.slice(0, maxChars);
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

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
  const pendingInboundByPhone = new Map<string, PendingInbound>();

  const safeReply = async (to: string, message: string, replyToMessageId?: string | null) => {
    try {
      const contextualReplyId =
        replyToMessageId && shouldApplyProbability(env.whatsappReplyContextProbability)
          ? replyToMessageId
          : null;
      await sendWhatsappText(to, message, {
        replyToMessageId: contextualReplyId
      });
      trackOutboundMessage({ messageType: "text" });
      return true;
    } catch (err) {
      trackOperationalError();
      fastify.log.warn({ err, to, replyToMessageId: replyToMessageId ?? null }, "WhatsApp reply failed");
      return false;
    }
  };

  const safeAudioReply = async (
    to: string,
    input: { data: Buffer; mimeType: string; filename: string },
    replyToMessageId?: string | null,
    asVoiceMessage = false
  ) => {
    try {
      const contextualReplyId =
        replyToMessageId && shouldApplyProbability(env.whatsappReplyContextProbability)
          ? replyToMessageId
          : null;
      await sendWhatsappAudio(to, input, {
        replyToMessageId: contextualReplyId,
        asVoiceMessage
      });
      trackOutboundMessage({ messageType: "audio" });
      return true;
    } catch (err) {
      trackOperationalError();
      fastify.log.warn({ err, to, replyToMessageId: replyToMessageId ?? null }, "WhatsApp audio reply failed");
      return false;
    }
  };

  const clearPendingInbound = (phoneE164: string) => {
    const pending = pendingInboundByPhone.get(phoneE164);
    if (!pending) return;
    if (pending.timer) clearTimeout(pending.timer);
    pendingInboundByPhone.delete(phoneE164);
  };

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

  const processBufferedInbound = async (phoneE164: string) => {
    const pending = pendingInboundByPhone.get(phoneE164);
    if (!pending) return;
    pendingInboundByPhone.delete(phoneE164);
    if (pending.timer) {
      clearTimeout(pending.timer);
      pending.timer = null;
    }

    const incomingMessageId = pending.lastIncomingMessageId ?? null;
    const text = pending.chunks
      .map((item) => String(item ?? "").trim())
      .filter(Boolean)
      .join("\n")
      .trim();
    if (!text) return;

    const agentReply = await handleProjectAgentMessage({
      phoneE164,
      text
    });
    const replyText = String(agentReply.reply ?? "").trim();
    if (!agentReply.handled || !replyText) {
      return;
    }
    trackAgentReplyGenerated();

    let audioSent = false;
    const isLongReply = replyText.length > MAX_TEXT_REPLY_CHARS;
    const shouldSendAudio =
      isLongReply &&
      env.whatsappAudioReplyEnabled &&
      isElevenLabsConfigured();

    if (shouldSendAudio) {
      try {
        const generatedAudio = await synthesizeSpeechWithElevenLabs(replyText);
        const isVoiceCompatible =
          generatedAudio.mimeType === "audio/ogg" ||
          generatedAudio.filename.toLowerCase().endsWith(".ogg");
        const useVoiceNote =
          isVoiceCompatible &&
          shouldApplyProbability(env.whatsappAudioVoiceNoteProbability);
        audioSent = await safeAudioReply(
          phoneE164,
          {
            data: generatedAudio.data,
            mimeType: generatedAudio.mimeType,
            filename: generatedAudio.filename
          },
          incomingMessageId,
          useVoiceNote
        );
        if (!isVoiceCompatible) {
          fastify.log.info(
            {
              from: phoneE164,
              outputFormat: env.elevenlabsOutputFormat
            },
            "Audio reply sent as regular audio. Configure ELEVENLABS_OUTPUT_FORMAT=opus_48000_64 for WhatsApp voice-note style."
          );
        }
      } catch (err) {
        trackOperationalError();
        fastify.log.warn(
          { err, from: phoneE164, incomingMessageId },
          "ElevenLabs audio generation failed"
        );
      }
    }

    if (audioSent) {
      return;
    }

    const textReply = toTextChannelReply(replyText);
    await safeReply(phoneE164, textReply, incomingMessageId);
  };

  const enqueueInbound = (input: {
    phoneE164: string;
    text: string;
    incomingMessageId: string | null;
  }) => {
    const existing = pendingInboundByPhone.get(input.phoneE164);
    const pending: PendingInbound = existing ?? {
      chunks: [],
      lastIncomingMessageId: null,
      timer: null
    };

    pending.chunks.push(input.text);
    if (input.incomingMessageId) {
      pending.lastIncomingMessageId = input.incomingMessageId;
    }
    if (pending.timer) {
      clearTimeout(pending.timer);
    }
    pending.timer = setTimeout(() => {
      void processBufferedInbound(input.phoneE164).catch((err) => {
        trackOperationalError();
        fastify.log.error({ err, from: input.phoneE164 }, "Buffered inbound processing failed");
      });
    }, USER_MESSAGE_DEBOUNCE_MS);

    pendingInboundByPhone.set(input.phoneE164, pending);
  };

  fastify.addHook("onClose", async () => {
    for (const pending of pendingInboundByPhone.values()) {
      if (pending.timer) clearTimeout(pending.timer);
    }
    pendingInboundByPhone.clear();
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
        messageType === "reaction" ||
        Boolean(String(msg.reaction?.emoji ?? "").trim());
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
            incomingMessageId
          );
          continue;
        }
      }

      if (!text) continue;

      const otp = extractOtp(text);
      if (otp) {
        clearPendingInbound(from);
        trackOtpMessage();
        const result = await consumeBridgeOtp(fastify, {
          from,
          otp,
          text
        });

        if (result.handled) {
          if (result.status === "verified") {
            await safeReply(
              from,
              "Codigo verificado. Vuelve a la app para continuar.",
              incomingMessageId
            );
            await dispatchDueBridgeEvents(fastify, {
              projectKey: result.session.project_key,
              limit: 20
            });
          } else {
            await safeReply(
              from,
              "Codigo invalido o expirado. Genera uno nuevo en la app.",
              incomingMessageId
            );
          }
          continue;
        }
      }
      enqueueInbound({
        phoneE164: from,
        text,
        incomingMessageId: incomingMessageId || null
      });
    }

    return { ok: true };
  });
};
