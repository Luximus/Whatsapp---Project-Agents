import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { requireBridgeProjectAuth } from "../lib/bridge.js";
import {
  claimInboxConversation,
  closeInboxConversation,
  ensureInboxConversation,
  getInboxConversation,
  listInboxConversations,
  listInboxMessages,
  markHandoffNotified,
  recordInboxOutbound,
  requestHumanHandoff
} from "../lib/inbox.js";
import { sendMetaRich, sendMetaText } from "../lib/metaMessaging.js";
import { sanitizeRichBlocks } from "../lib/richMessaging.js";
import { sendSupportTicketEmail } from "../lib/reporting.js";
import { sendWhatsappRich, sendWhatsappTemplate, sendWhatsappText } from "../lib/whatsapp.js";

const uuid = z.string().uuid();
const actor = z.object({ userId: z.string().min(1).max(200), email: z.string().email() });
const querySchema = z.object({
  status: z.enum(["ai_active", "waiting_human", "human_active", "closed"]).optional(),
  channel: z.enum(["whatsapp", "messenger"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).optional(),
  search: z.string().trim().max(120).optional()
});

function externalMessageId(payload: any): string | null {
  return String(payload?.messages?.[0]?.id ?? payload?.messageId ?? "").trim() || null;
}

export const inboxRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/api/bridge/inbox/campaigns/send", async (request, reply) => {
    const auth = requireBridgeProjectAuth(request);
    const input = z.object({
      channel: z.enum(["whatsapp", "messenger"]), contactKey: z.string().min(1).max(200),
      templateName: z.string().trim().min(1).max(160), languageCode: z.string().trim().max(12).default("es"),
      components: z.array(z.record(z.string(), z.unknown())).max(10).default([]), campaignId: z.string().uuid()
    }).parse(request.body);
    if (input.channel !== "whatsapp") {
      return reply.code(409).send({ ok: false, error: "messenger_marketing_template_not_configured" });
    }
    const conversation = await ensureInboxConversation(fastify, {
      projectKey: auth.projectKey, channel: "whatsapp", contactKey: input.contactKey,
      metadata: { lastCampaignId: input.campaignId }
    });
    const result = await sendWhatsappTemplate({ toE164: input.contactKey, name: input.templateName, languageCode: input.languageCode, components: input.components });
    const id = externalMessageId(result);
    await recordInboxOutbound(fastify, { conversationId: conversation.id, externalMessageId: id, actor: "system", kind: "template", content: `[Plantilla: ${input.templateName}]`, deliveryStatus: "sent", metadata: { campaignId: input.campaignId } });
    return { ok: true, data: { messageId: id } };
  });

  fastify.get("/api/bridge/inbox/conversations", async (request) => {
    const auth = requireBridgeProjectAuth(request);
    const query = querySchema.parse(request.query ?? {});
    return { ok: true, data: await listInboxConversations(fastify, auth.projectKey, query) };
  });

  fastify.get("/api/bridge/inbox/conversations/:id", async (request, reply) => {
    const auth = requireBridgeProjectAuth(request);
    const id = uuid.parse((request.params as any).id);
    const conversation = await getInboxConversation(fastify, auth.projectKey, id);
    if (!conversation) return reply.code(404).send({ ok: false, error: "conversation_not_found" });
    const messages = await listInboxMessages(fastify, id, Number((request.query as any)?.limit ?? 200));
    return { ok: true, data: { conversation, messages } };
  });

  fastify.post("/api/bridge/inbox/conversations/:id/claim", async (request, reply) => {
    const auth = requireBridgeProjectAuth(request);
    const id = uuid.parse((request.params as any).id);
    const input = actor.extend({ force: z.boolean().optional() }).parse(request.body);
    const row = await claimInboxConversation(fastify, auth.projectKey, id, input);
    if (!row) return reply.code(409).send({ ok: false, error: "conversation_already_claimed" });
    return { ok: true, data: row };
  });

  fastify.post("/api/bridge/inbox/conversations/:id/handoff", async (request, reply) => {
    const auth = requireBridgeProjectAuth(request);
    const id = uuid.parse((request.params as any).id);
    const input = z.object({ reason: z.string().max(300).optional(), summary: z.string().max(5000).optional() }).parse(request.body ?? {});
    const existing = await getInboxConversation(fastify, auth.projectKey, id);
    if (!existing) return reply.code(404).send({ ok: false, error: "conversation_not_found" });
    const row = await requestHumanHandoff(fastify, id, input);
    if (!row) return { ok: true, data: existing };
    const result = await sendSupportTicketEmail({
      projectKey: auth.projectKey,
      userPhone: `${row.channel}:${row.contactKey}`,
      contactName: row.displayName ?? "",
      contactEmail: "",
      company: "",
      topic: input.reason ?? "Atención humana",
      summary: input.summary ?? "Conversación enviada a la bandeja humana.",
      recipient: "quote@luxisoft.com"
    });
    if (result.sent) await markHandoffNotified(fastify, id);
    return { ok: true, data: row, notified: result.sent };
  });

  fastify.post("/api/bridge/inbox/conversations/:id/close", async (request, reply) => {
    const auth = requireBridgeProjectAuth(request);
    const id = uuid.parse((request.params as any).id);
    const input = actor.extend({ summary: z.string().max(5000).optional() }).parse(request.body);
    const row = await closeInboxConversation(fastify, auth.projectKey, id, input);
    if (!row) return reply.code(409).send({ ok: false, error: "conversation_not_owned" });
    return { ok: true, data: row };
  });

  fastify.post("/api/bridge/inbox/conversations/:id/messages", async (request, reply) => {
    const auth = requireBridgeProjectAuth(request);
    const id = uuid.parse((request.params as any).id);
    const input = actor.extend({ text: z.string().trim().max(4096).default(""), rich: z.array(z.unknown()).max(8).default([]) }).parse(request.body);
    const conversation = await getInboxConversation(fastify, auth.projectKey, id);
    if (!conversation) return reply.code(404).send({ ok: false, error: "conversation_not_found" });
    if (conversation.status !== "human_active" || conversation.assignedUserId !== input.userId) {
      return reply.code(409).send({ ok: false, error: "conversation_not_owned" });
    }
    const rich = sanitizeRichBlocks(input.rich);
    if (!input.text && !rich.length) return reply.code(400).send({ ok: false, error: "message_required" });
    let sentId: string | null = null;
    try {
      if (input.text) {
        const result = conversation.channel === "whatsapp"
          ? await sendWhatsappText(conversation.contactKey, input.text)
          : await sendMetaText({ channel: "messenger", recipientId: conversation.contactKey, text: input.text });
        sentId = externalMessageId(result);
      }
      for (const block of rich) {
        const result = conversation.channel === "whatsapp"
          ? await sendWhatsappRich(conversation.contactKey, block)
          : await sendMetaRich({ channel: "messenger", recipientId: conversation.contactKey, block });
        sentId ||= externalMessageId(result);
      }
      const message = await recordInboxOutbound(fastify, {
        conversationId: id, externalMessageId: sentId, actor: "human",
        actorUserId: input.userId, actorEmail: input.email, content: input.text,
        rich, deliveryStatus: "sent"
      });
      return { ok: true, data: message };
    } catch (error: any) {
      await recordInboxOutbound(fastify, {
        conversationId: id, actor: "human", actorUserId: input.userId,
        actorEmail: input.email, content: input.text, rich,
        deliveryStatus: "failed", error: String(error?.message ?? error)
      });
      throw error;
    }
  });
};
