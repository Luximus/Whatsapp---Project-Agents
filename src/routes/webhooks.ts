import type { FastifyPluginAsync } from "fastify";
import { consumeBridgeOtp, dispatchDueBridgeEvents } from "../lib/bridge.js";
import { env } from "../env.js";
import { verifyWhatsappSignature } from "../lib/whatsappSignature.js";
import { transcribeAudio } from "../lib/ai/index.js";
import { t, detectLocale } from "../i18n/index.js";
import { consumeWhatsappVerificationCode } from "../lib/whatsappVerification.js";
import {
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
  // Conservamos el cuerpo crudo SOLO en este contexto encapsulado (las rutas
  // del webhook) para poder verificar la firma HMAC de Meta sobre los bytes
  // exactos. El resto de rutas de la app siguen usando el parser JSON normal.
  fastify.addContentTypeParser(
    "application/json",
    { parseAs: "buffer" },
    (request, body, done) => {
      (request as any).rawBody = body as Buffer;
      try {
        const parsed = (body as Buffer).length
          ? JSON.parse((body as Buffer).toString("utf8"))
          : {};
        done(null, parsed);
      } catch (err) {
        done(err as Error, undefined);
      }
    }
  );

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

  fastify.post("/api/webhooks/whatsapp", async (request, reply) => {
    if (env.WHATSAPP_APP_SECRET) {
      const valid = verifyWhatsappSignature({
        appSecret: env.WHATSAPP_APP_SECRET,
        rawBody: (request as any).rawBody ?? Buffer.alloc(0),
        signatureHeader: request.headers["x-hub-signature-256"] as string | undefined
      });
      if (!valid) {
        fastify.log.warn({ url: request.url }, "WhatsApp webhook signature verification failed");
        reply.code(401);
        return { error: "invalid_signature" };
      }
    } else {
      fastify.log.warn(
        "WHATSAPP_APP_SECRET not set: skipping webhook signature verification (insecure)"
      );
    }

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
      // Idioma inicial inferido del texto entrante; se reevalúa tras transcribir.
      let locale = detectLocale(text);
      const isAudioInput = messageType === "audio" || (!!msg.audio?.id && !text);
      trackInboundMessage({
        fromE164: from,
        messageType: isAudioInput ? "audio" : "text"
      });

      if (isAudioInput && msg.audio?.id) {
        try {
          const media = await downloadWhatsappMedia(msg.audio.id);
          text = await transcribeAudio({
            data: media.data,
            mimeType: media.mimeType,
            filename: media.filename
          });
          text = text.trim();
          locale = detectLocale(text);
        } catch (err) {
          fastify.log.warn(
            { err, from, incomingMessageId, mediaId: msg.audio.id ?? null },
            "Audio transcription failed"
          );
          trackOpenAIFailure();
          trackOperationalError();
          await safeReply(from, t("audio_transcription_failed", locale), incomingMessageId);
          continue;
        }
      }

      if (!text) continue;

      const otp = extractOtp(text);
      if (otp) {
        trackOtpMessage();
        const bridgeResult = await consumeBridgeOtp(fastify, {
          from,
          otp,
          text
        });

        if (bridgeResult.handled) {
          if (bridgeResult.status === "verified") {
            await safeReply(from, t("code_verified", locale), incomingMessageId);
            await dispatchDueBridgeEvents(fastify, {
              projectKey: bridgeResult.session.project_key,
              limit: 20
            });
          } else {
            await safeReply(from, t("code_invalid_or_expired", locale), incomingMessageId);
          }
          continue;
        }

        const verificationResult = await consumeWhatsappVerificationCode(fastify, {
          phoneE164: from,
          code: otp
        });
        if (verificationResult.handled) {
          await safeReply(
            from,
            verificationResult.status === "verified"
              ? t("code_verified", locale)
              : t("code_invalid_or_expired", locale),
            incomingMessageId
          );
          continue;
        }

        await safeReply(from, t("code_invalid_or_expired", locale), incomingMessageId);
        continue;
      }

      await safeReply(from, t("verification_help", locale), incomingMessageId || null);
    }

    return { ok: true };
  });
};
