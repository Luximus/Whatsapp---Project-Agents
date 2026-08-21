import type { FastifyInstance, FastifyPluginAsync } from "fastify";
import { env } from "../env.js";
import { handleAgentMessage, type AgentActions } from "../lib/agents/index.js";
import {
  loadConversationHistory,
  recordConversationTurn
} from "../lib/agents/conversation/index.js";
import {
  flattenMetaMessagingEvents,
  sendMetaRich,
  sendMetaSenderAction,
  sendMetaText,
  type MetaMessagingEvent
} from "../lib/metaMessaging.js";
import {
  markInboxCommercialSignal,
  markHandoffNotified,
  recordInboxInbound,
  recordInboxOutbound,
  requestHumanHandoff,
  type InboxConversation
} from "../lib/inbox.js";
import {
  sendMeetingQuoteEmail,
  sendSupportTicketEmail,
  trackMeetingScheduled,
  trackOperationalError,
  trackSupportTicketCreated
} from "../lib/reporting.js";
import { verifyWhatsappSignature } from "../lib/whatsappSignature.js";

const MESSAGE_DEDUP_TTL_MS = 10 * 60 * 1000;
const seenMessages = new Map<string, number>();

function rememberMessage(event: MetaMessagingEvent): boolean {
  const now = Date.now();
  for (const [key, expiresAt] of seenMessages) {
    if (expiresAt <= now) seenMessages.delete(key);
  }
  const key = `${event.channel}:${event.messageId}`;
  if (seenMessages.has(key)) return false;
  seenMessages.set(key, now + MESSAGE_DEDUP_TTL_MS);
  return true;
}

function conversationId(event: MetaMessagingEvent) {
  return `${event.channel}:${event.senderId}`;
}

function buildCommercialActions(fastify: FastifyInstance, event: MetaMessagingEvent, conversation: InboxConversation): AgentActions {
  const userId = conversationId(event);
  return {
    async captureCommercialLead(input) {
      const updated = await markInboxCommercialSignal(fastify, conversation.id, {
        reason: input.reason,
        service: input.service,
        actor: "ai"
      });
      return { ok: Boolean(updated) };
    },
    async scheduleMeeting(input) {
      const record = {
        projectKey: env.defaultProject,
        userPhone: userId,
        contactName: input.contactName || "",
        contactEmail: input.contactEmail || "",
        company: input.company || "",
        meetingDay: input.meetingDay || "",
        meetingDate: input.meetingDate || "",
        meetingTime: input.meetingTime ?? null,
        reason: input.reason || input.service || "",
        notifiedHuman: false
      };
      const result = await sendMeetingQuoteEmail(record);
      if (result.sent) trackMeetingScheduled(record);
      else
        fastify.log.warn(
          { channel: event.channel, error: result.error },
          "Meta meeting email failed"
        );
      return { ok: result.sent, message: result.error };
    },

    async escalateToHuman(input) {
      await requestHumanHandoff(fastify, conversation.id, {
        reason: input.topic || `transferencia desde ${event.channel}`,
        summary: input.summary || ""
      });
      const result = await sendSupportTicketEmail({
        projectKey: env.defaultProject,
        userPhone: userId,
        contactName: input.contactName || "",
        contactEmail: input.contactEmail || "",
        company: input.company || "",
        topic: input.topic || `transferencia desde ${event.channel}`,
        summary: input.summary || "",
        recipient: "quote@luxisoft.com"
      });
      if (result.sent) {
        trackSupportTicketCreated();
        await markHandoffNotified(fastify, conversation.id);
      }
      else
        fastify.log.warn(
          { channel: event.channel, error: result.error },
          "Meta support email failed"
        );
      return { ok: result.sent, message: result.error };
    }
  };
}

async function processMessage(fastify: FastifyInstance, event: MetaMessagingEvent) {
  const identity = conversationId(event);
  let inboxConversation: InboxConversation | null = null;
  try {
    const conversation = await recordInboxInbound(fastify, {
      projectKey: env.defaultProject,
      channel: "messenger",
      contactKey: event.senderId,
      externalMessageId: event.messageId,
      content: event.text,
      metadata: { timestamp: event.timestamp }
    });
    inboxConversation = conversation;
    if (conversation.status === "waiting_human" || conversation.status === "human_active") {
      fastify.log.info({ conversationId: conversation.id, status: conversation.status }, "Meta message queued for human; AI paused");
      return;
    }
    void sendMetaSenderAction({ channel: event.channel, recipientId: event.senderId, action: "mark_seen" }).catch(() => {});
    void sendMetaSenderAction({ channel: event.channel, recipientId: event.senderId, action: "typing_on" }).catch(() => {});
    const history = await loadConversationHistory(fastify, {
      projectKey: env.defaultProject,
      phoneE164: identity
    });
    const result = await handleAgentMessage({
      projectKey: env.defaultProject,
      userMessage: event.text,
      history,
      context: {
        from: identity,
        channel: event.channel,
        logger: fastify.log,
        actions: buildCommercialActions(fastify, event, conversation)
      }
    });
    const text = result.text?.trim();
    if (!text) return;

    const sent = await sendMetaText({ channel: event.channel, recipientId: event.senderId, text });
    for (const block of result.rich) {
      try { await sendMetaRich({ channel: event.channel, recipientId: event.senderId, block }); }
      catch (err) { fastify.log.warn({ err, kind: block.kind }, "Meta rich block failed; text retained"); }
    }
    void sendMetaSenderAction({ channel: event.channel, recipientId: event.senderId, action: "typing_off" }).catch(() => {});
    await recordInboxOutbound(fastify, {
      conversationId: conversation.id,
      externalMessageId: sent.messageId,
      actor: "ai",
      content: text,
      rich: result.rich,
      deliveryStatus: "sent"
    });
    await recordConversationTurn(fastify, {
      projectKey: env.defaultProject,
      phoneE164: identity,
      userMessage: event.text,
      assistantMessage: text
    });
    fastify.log.info(
      { channel: event.channel, senderId: event.senderId, incomingMessageId: event.messageId },
      "Meta agent reply sent"
    );
  } catch (err) {
    trackOperationalError();
    if (inboxConversation) {
      await recordInboxOutbound(fastify, {
        conversationId: inboxConversation.id,
        actor: "ai",
        content: "",
        deliveryStatus: "failed",
        error: err instanceof Error ? err.message.slice(0, 1000) : String(err).slice(0, 1000),
        metadata: { learningEligible: true }
      }).catch(() => undefined);
    }
    fastify.log.warn(
      { err, channel: event.channel, senderId: event.senderId, messageId: event.messageId },
      "Meta agent reply failed"
    );
  }
}

export const metaWebhookRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as typeof request & { rawBody?: Buffer }).rawBody = body as Buffer;
    try {
      done(null, (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {});
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  fastify.get("/api/webhooks/meta", async (request, reply) => {
    const query = request.query as Record<string, unknown>;
    if (
      query?.["hub.mode"] === "subscribe" &&
      query?.["hub.verify_token"] === env.metaWebhookVerifyToken
    ) {
      reply.code(200).send(query?.["hub.challenge"] ?? "");
      return;
    }
    reply.code(403).send("Invalid token");
  });

  fastify.post("/api/webhooks/meta", async (request, reply) => {
    const valid = verifyWhatsappSignature({
      appSecret: env.metaAppSecret,
      rawBody: (request as typeof request & { rawBody?: Buffer }).rawBody ?? Buffer.alloc(0),
      signatureHeader: request.headers["x-hub-signature-256"] as string | undefined
    });
    if (!valid) {
      fastify.log.warn({ url: request.url }, "Meta webhook signature verification failed");
      reply.code(401);
      return { error: "invalid_signature" };
    }

    const events = flattenMetaMessagingEvents(request.body);
    if (!env.metaMessengerEnabled && !env.metaInstagramEnabled) {
      fastify.log.warn({ eventCount: events.length }, "Meta webhook received while agent disabled");
      return { ok: true };
    }

    for (const event of events) {
      const channelEnabled =
        event.channel === "messenger" ? env.metaMessengerEnabled : env.metaInstagramEnabled;
      if (!channelEnabled) {
        fastify.log.info(
          { channel: event.channel, messageId: event.messageId },
          "Ignoring message from disabled Meta channel"
        );
        continue;
      }
      if (!rememberMessage(event)) {
        fastify.log.info(
          { channel: event.channel, messageId: event.messageId },
          "Ignoring duplicate Meta message"
        );
        continue;
      }
      // Meta exige ACK rápido. El procesamiento del modelo y el envío continúan
      // fuera del ciclo de respuesta; cualquier fallo queda registrado.
      void processMessage(fastify, event);
    }
    return { ok: true };
  });
};
