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
  resolveBridgeSessionStatus,
  verifyBridgeSessionCode
} from "../lib/bridge.js";
import { normalizeE164, sendWhatsappText } from "../lib/whatsapp.js";
import { parseOrThrow } from "../lib/zod.js";

const flowSchema = z.enum(BRIDGE_FLOWS);

const startBodySchema = z.object({
  flow: flowSchema.optional().default("verification"),
  phone_e164: z.string().min(1).max(40),
  user_code: z.string().regex(/^\d{6}$/).optional(),
  user_ref: z.string().min(1).max(128).optional(),
  correlation_id: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

const webhookRequestBodySchema = startBodySchema.extend({
  user_code: z.string().regex(/^\d{6}$/)
});

const verifyBodySchema = z.object({
  session_id: z.string().uuid(),
  code: z.string().regex(/^\d{6}$/)
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

  const session = await createBridgeSession(fastify, {
    projectKey: input.projectKey,
    flow: input.body.flow,
    phoneE164,
    userCode: input.body.user_code,
    userRef: input.body.user_ref,
    correlationId: input.body.correlation_id,
    metadata: input.body.metadata ?? null,
    callbackUrl: input.callbackUrl
  });

  const message = buildBridgeMessage(session.flow, session.code, session.otp_ref);
  let deliveryOk = false;
  let waMessageId: string | null = null;
  let deliveryError: { message: string; status_code: number | null; details: unknown } | null = null;

  try {
    const waSendResult = await sendWhatsappText(phoneE164, message);
    waMessageId =
      waSendResult &&
      typeof waSendResult === "object" &&
      Array.isArray((waSendResult as any).messages) &&
      (waSendResult as any).messages[0] &&
      typeof (waSendResult as any).messages[0].id === "string"
        ? String((waSendResult as any).messages[0].id)
        : null;
    deliveryOk = true;
  } catch (err: any) {
    deliveryError = {
      message: String(err?.message ?? "whatsapp_send_failed"),
      status_code: typeof err?.statusCode === "number" ? err.statusCode : null,
      details: err?.details ?? null
    };
    fastify.log.warn(
      {
        projectKey: input.projectKey,
        phoneE164,
        deliveryError
      },
      "Bridge WhatsApp delivery failed"
    );
  }

  return {
    session,
    deliveryMode: "cloud_api" as const,
    instructions: deliveryOk
      ? "Codigo enviado a WhatsApp del usuario."
      : "No fue posible entregar el codigo por WhatsApp.",
    waMessageId,
    deliveryOk,
    deliveryError
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
      otp_code: session.code,
      phone_e164: session.phone_e164,
      otp_reference: session.otp_ref,
      expires_at: session.expires_at.toISOString(),
      delivery_mode: created.deliveryMode,
      instructions: created.instructions,
      wa_message_id: created.waMessageId,
      delivery_ok: created.deliveryOk,
      delivery_error: created.deliveryError
    };
  });

  fastify.post("/api/bridge/webhooks/request", async (request) => {
    const auth = requireBridgeProjectAuth(request);
    const body = parseOrThrow(webhookRequestBodySchema, request.body);
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
        code: session.code,
        otp_ref: session.otp_ref,
        user_ref: session.user_ref,
        correlation_id: session.correlation_id,
        expires_at: session.expires_at.toISOString(),
        metadata: session.metadata ?? null
      },
      delivery: {
        mode: created.deliveryMode,
        instructions: created.instructions,
        wa_message_id: created.waMessageId,
        ok: created.deliveryOk,
        error: created.deliveryError
      }
    };

    await enqueueBridgeEvent(fastify, {
      session,
      eventType: "bridge.session.requested",
      payload
    });
    await dispatchDueBridgeEvents(fastify, { projectKey: auth.projectKey, limit: 10 });

    return {
      accepted: created.deliveryOk,
      project_key: session.project_key,
      session_id: session.id,
      otp_code: session.code,
      wa_message_id: created.waMessageId,
      delivery_ok: created.deliveryOk,
      delivery_error: created.deliveryError
    };
  });

  fastify.post("/api/bridge/webhooks/verify", async (request) => {
    const auth = requireBridgeProjectAuth(request);
    const body = parseOrThrow(verifyBodySchema, request.body);

    const result = await verifyBridgeSessionCode(fastify, {
      projectKey: auth.projectKey,
      sessionId: body.session_id,
      code: body.code
    });

    if (!result.found) {
      throw Object.assign(new Error("bridge_session_not_found"), { statusCode: 404 });
    }

    await dispatchDueBridgeEvents(fastify, { projectKey: auth.projectKey, limit: 10 });

    return {
      project_key: auth.projectKey,
      session_id: result.session.id,
      status: result.status,
      verified: result.status === "verified",
      attempts: result.session.attempts,
      expires_at: result.session.expires_at.toISOString(),
      verified_at: result.session.verified_at?.toISOString() ?? null
    };
  });

  fastify.get("/api/bridge/sessions/:session_id", async (request) => {
    const auth = requireBridgeProjectAuth(request);
    const params = parseOrThrow(sessionParamsSchema, request.params);

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
