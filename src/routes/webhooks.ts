import type { FastifyPluginAsync } from "fastify";
import { consumeBridgeOtp, dispatchDueBridgeEvents } from "../lib/bridge.js";
import { env } from "../env.js";
import { handleProjectAgentMessage } from "../lib/projectAgent.js";
import {
  extractOtp,
  normalizeE164,
  sendWhatsappText,
  sendWhatsappTypingIndicator
} from "../lib/whatsapp.js";

type WebhookMessage = {
  id?: string;
  from?: string;
  text?: { body?: string };
};

type WebhookStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

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
  const safeReply = async (to: string, message: string) => {
    try {
      await sendWhatsappText(to, message);
    } catch (err) {
      fastify.log.warn({ err, to }, "WhatsApp reply failed");
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
      const from = msg.from ? normalizeE164(msg.from) : null;
      const text = String(msg.text?.body ?? "").trim();
      if (!from || !text) continue;

      const otp = extractOtp(text);
      if (otp) {
        const result = await consumeBridgeOtp(fastify, {
          from,
          otp,
          text
        });

        if (result.handled) {
          if (result.status === "verified") {
            await safeReply(from, "Codigo verificado. Vuelve a la app para continuar.");
            await dispatchDueBridgeEvents(fastify, {
              projectKey: result.session.project_key,
              limit: 20
            });
          } else {
            await safeReply(from, "Codigo invalido o expirado. Genera uno nuevo en la app.");
          }
          continue;
        }
      }

      const incomingMessageId = String(msg.id ?? "").trim();
      if (incomingMessageId) {
        try {
          await sendWhatsappTypingIndicator(incomingMessageId);
        } catch (err) {
          fastify.log.warn(
            { err, incomingMessageId, from },
            "WhatsApp typing indicator failed"
          );
        }
      }

      const agentReply = await handleProjectAgentMessage({
        phoneE164: from,
        text
      });
      if (!agentReply.handled || !agentReply.reply.trim()) {
        continue;
      }

      await safeReply(from, agentReply.reply);
    }

    return { ok: true };
  });
};
