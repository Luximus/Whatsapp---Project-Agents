import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import {
  BRIDGE_FLOWS,
  buildBridgeMessage,
  createBridgeSession,
  dispatchDueBridgeEvents,
  enqueueBridgeEvent,
  getBridgeSessionById,
  getBridgeSessionEventStatus,
  refreshBridgeSessionStatus,
  requireBridgeProjectAuth,
  requireDispatchToken,
  resolveBridgeSessionStatus
} from "../lib/bridge.js";
import { ensureProjectActive } from "../lib/projectKey.js";
import { buildWaUrl, normalizeE164, sendWhatsappText } from "../lib/whatsapp.js";
import { parseOrThrow } from "../lib/zod.js";

const flowSchema = z.enum(BRIDGE_FLOWS);

const startBodySchema = z.object({
  flow: flowSchema.optional().default("verification"),
  phone_e164: z.string().min(1).max(40),
  user_ref: z.string().min(1).max(128).optional(),
  correlation_id: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
  delivery_mode: z.enum(["wa_link", "cloud_api"]).optional().default("wa_link")
});

const sessionParamsSchema = z.object({
  session_id: z.string().uuid()
});

const dispatchBodySchema = z.object({
  project_key: z.string().min(2).max(64).optional(),
  limit: z.coerce.number().int().min(1).max(500).optional()
});

function requireE164(value: string) {
  const normalized = normalizeE164(value);
  if (!normalized || !/^\+\d{8,16}$/.test(normalized)) {
    throw Object.assign(new Error("whatsapp_invalid_phone"), { statusCode: 400 });
  }
  return normalized;
}

function asIso(value: unknown) {
  if (!value) return null;
  const date = value instanceof Date ? value : new Date(String(value));
  if (Number.isNaN(date.getTime())) return null;
  return date.toISOString();
}

async function createSessionRequest(
  fastify: any,
  input: {
    projectKey: string;
    callbackUrl: string | null;
    body: z.infer<typeof startBodySchema>;
  }
) {
  const phoneE164 = requireE164(input.body.phone_e164);
  await ensureProjectActive(fastify, input.projectKey);

  if (!env.WHATSAPP_VERIFY_NUMBER_E164) {
    throw Object.assign(new Error("whatsapp_verify_number_missing"), { statusCode: 500 });
  }

  const session = await createBridgeSession(fastify, {
    projectKey: input.projectKey,
    flow: input.body.flow,
    phoneE164,
    userRef: input.body.user_ref,
    correlationId: input.body.correlation_id,
    metadata: input.body.metadata ?? null,
    callbackUrl: input.callbackUrl
  });

  const message = buildBridgeMessage(session.flow, session.code, session.otp_ref);
  let deliveryMode = "wa_link";
  let waUrl: string | null = null;

  if (input.body.delivery_mode === "cloud_api") {
    await sendWhatsappText(phoneE164, message);
    deliveryMode = "cloud_api";
  } else {
    waUrl = buildWaUrl(env.WHATSAPP_VERIFY_NUMBER_E164, message);
  }

  const instructions =
    deliveryMode === "wa_link"
      ? "Abre wa_url y envia el mensaje prellenado para completar la verificacion."
      : "Codigo enviado por WhatsApp Cloud API.";

  return {
    session,
    deliveryMode,
    waUrl,
    instructions
  };
}

export const bridgeRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post("/api/bridge/sessions/start", async (request) => {
    const auth = requireBridgeProjectAuth(request);
    const body = parseOrThrow(startBodySchema, request.body);
    const created = await createSessionRequest(fastify, {
      projectKey: auth.projectKey,
      callbackUrl: auth.config.callbackUrl,
      body
    });
    const session = created.session;

    return {
      project_key: session.project_key,
      session_id: session.id,
      flow: session.flow,
      status: resolveBridgeSessionStatus(session),
      phone_e164: session.phone_e164,
      otp_reference: session.otp_ref,
      expires_at: session.expires_at.toISOString(),
      delivery_mode: created.deliveryMode,
      wa_url: created.waUrl,
      instructions: created.instructions
    };
  });

  fastify.post("/api/bridge/webhooks/request", async (request) => {
    const auth = requireBridgeProjectAuth(request);
    const body = parseOrThrow(startBodySchema, request.body);
    const created = await createSessionRequest(fastify, {
      projectKey: auth.projectKey,
      callbackUrl: auth.config.callbackUrl,
      body
    });
    const session = created.session;

    const payload = {
      event_type: "bridge.session.requested",
      occurred_at: new Date().toISOString(),
      project_key: session.project_key,
      session: {
        id: session.id,
        flow: session.flow,
        status: resolveBridgeSessionStatus(session),
        phone_e164: session.phone_e164,
        otp_ref: session.otp_ref,
        user_ref: session.user_ref,
        correlation_id: session.correlation_id,
        expires_at: session.expires_at.toISOString(),
        metadata: session.metadata ?? null
      },
      delivery: {
        mode: created.deliveryMode,
        wa_url: created.waUrl,
        instructions: created.instructions
      }
    };

    await enqueueBridgeEvent(fastify, {
      session,
      eventType: "bridge.session.requested",
      payload
    });
    await dispatchDueBridgeEvents(fastify, { projectKey: auth.projectKey, limit: 10 });

    return {
      accepted: true,
      project_key: session.project_key,
      session_id: session.id
    };
  });

  fastify.get("/api/bridge/sessions/:session_id", async (request) => {
    const auth = requireBridgeProjectAuth(request);
    const params = parseOrThrow(sessionParamsSchema, request.params);
    await ensureProjectActive(fastify, auth.projectKey);

    const session = await getBridgeSessionById(fastify, auth.projectKey, params.session_id);
    if (!session) {
      throw Object.assign(new Error("bridge_session_not_found"), { statusCode: 404 });
    }

    const updated = await refreshBridgeSessionStatus(fastify, session);
    await dispatchDueBridgeEvents(fastify, { projectKey: auth.projectKey, limit: 10 });
    const event = await getBridgeSessionEventStatus(fastify, updated.id);

    return {
      project_key: updated.project_key,
      session_id: updated.id,
      flow: updated.flow,
      status: resolveBridgeSessionStatus(updated),
      phone_e164: updated.phone_e164,
      user_ref: updated.user_ref,
      correlation_id: updated.correlation_id,
      expires_at: updated.expires_at.toISOString(),
      verified_at: updated.verified_at?.toISOString() ?? null,
      callback_delivery: event
        ? {
            event_id: event.id,
            event_type: event.event_type,
            status: event.delivery_status,
            attempts: event.delivery_attempts,
            next_retry_at: asIso(event.next_retry_at),
            delivered_at: asIso(event.delivered_at),
            last_error: event.last_error
          }
        : null
    };
  });

  fastify.post("/api/bridge/events/dispatch", async (request) => {
    requireDispatchToken(request);
    const body = parseOrThrow(dispatchBodySchema, request.body ?? {});
    const projectKey = body.project_key ? body.project_key.trim().toLowerCase() : undefined;

    if (projectKey && !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(projectKey)) {
      throw Object.assign(new Error("invalid_project_key"), { statusCode: 400 });
    }

    const result = await dispatchDueBridgeEvents(fastify, {
      projectKey,
      limit: body.limit ?? env.BRIDGE_EVENT_DISPATCH_LIMIT
    });

    return {
      ok: true,
      project_key: projectKey ?? null,
      ...result
    };
  });
};
