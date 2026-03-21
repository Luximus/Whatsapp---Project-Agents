import type { FastifyPluginAsync } from "fastify";
import { consumeBridgeOtp, dispatchDueBridgeEvents } from "../lib/bridge.js";
import { env } from "../env.js";
import { extractOtp, normalizeE164, sendWhatsappText } from "../lib/whatsapp.js";

type WebhookMessage = {
  id?: string;
  from?: string;
  text?: { body?: string };
};

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  const safeReply = async (to: string, message: string) => {
    try {
      await sendWhatsappText(to, message);
    } catch (err) {
      fastify.log.warn({ err }, "WhatsApp reply failed");
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
    const messages: WebhookMessage[] = body?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
    if (!messages.length) return { ok: true };

    for (const msg of messages) {
      const from = msg.from ? normalizeE164(msg.from) : null;
      const text = msg.text?.body ?? "";
      const otp = extractOtp(text);
      if (!from || !otp) continue;

      const result = await consumeBridgeOtp(fastify, {
        from,
        otp,
        text
      });

      if (!result.handled) continue;

      if (result.status === "verified") {
        await safeReply(from, "Codigo verificado. Vuelve a la app para continuar.");
        await dispatchDueBridgeEvents(fastify, {
          projectKey: result.session.project_key,
          limit: 20
        });
        continue;
      }

      await safeReply(from, "Codigo invalido o expirado. Genera uno nuevo en la app.");
    }

    return { ok: true };
  });
};
