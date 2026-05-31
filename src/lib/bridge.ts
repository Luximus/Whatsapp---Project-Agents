import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";
import { getBridgeStore } from "./bridge/factory.js";
import {
  BRIDGE_FLOWS,
  type BridgeFlow,
  type BridgeSessionRow
} from "./bridge/store.js";

export { BRIDGE_FLOWS };
export type { BridgeFlow, BridgeSessionRow };

function toComparableBuffer(value: string) {
  return Buffer.from(value, "utf8");
}

function safeSecretCompare(left: string, right: string) {
  const a = toComparableBuffer(left);
  const b = toComparableBuffer(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseHeaderString(headerValue: unknown) {
  if (Array.isArray(headerValue)) return typeof headerValue[0] === "string" ? headerValue[0] : null;
  return typeof headerValue === "string" ? headerValue : null;
}

function parseBearerToken(authHeader: unknown) {
  const raw = parseHeaderString(authHeader);
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function requireBridgeProjectAuth(request: any, expectedProjectKey?: string) {
  const rawProjectKey = parseHeaderString(request.headers?.["x-project-key"]);
  if (!rawProjectKey?.trim()) {
    throw Object.assign(new Error("bridge_project_key_missing"), { statusCode: 401 });
  }
  const projectKey = rawProjectKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(projectKey)) {
    throw Object.assign(new Error("invalid_project_key"), { statusCode: 400 });
  }

  if (expectedProjectKey && projectKey !== expectedProjectKey.trim().toLowerCase()) {
    throw Object.assign(new Error("bridge_project_key_mismatch"), { statusCode: 403 });
  }

  const configured = env.bridgeProjects[projectKey];
  if (!configured) {
    throw Object.assign(new Error("bridge_project_not_configured"), { statusCode: 403 });
  }

  const providedApiKey =
    parseHeaderString(request.headers?.["x-project-api-key"]) ??
    parseBearerToken(request.headers?.authorization);
  if (!providedApiKey?.trim()) {
    throw Object.assign(new Error("bridge_api_key_missing"), { statusCode: 401 });
  }
  if (!safeSecretCompare(providedApiKey.trim(), configured.apiKey)) {
    throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
  }

  return {
    projectKey,
    config: configured
  };
}

export function requireDispatchToken(request: any) {
  const configuredToken = env.BRIDGE_DISPATCH_TOKEN.trim();
  if (!configuredToken) {
    throw Object.assign(new Error("bridge_dispatch_not_configured"), { statusCode: 501 });
  }

  const providedToken =
    parseHeaderString(request.headers?.["x-bridge-dispatch-token"]) ??
    parseBearerToken(request.headers?.authorization);
  if (!providedToken?.trim()) {
    throw Object.assign(new Error("bridge_dispatch_token_missing"), { statusCode: 401 });
  }
  if (!safeSecretCompare(providedToken.trim(), configuredToken)) {
    throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
  }
}

export function generateOtpCode() {
  return String(randomInt(0, 1_000_000)).padStart(6, "0");
}

export function generateOtpReference() {
  return randomUUID().replace(/-/g, "").slice(0, 8).toUpperCase();
}

export function extractBridgeReference(text: string | null | undefined) {
  if (!text) return null;
  const match = text.match(/(?:ref|referencia|session|sesion|id)\s*[:#-]?\s*([a-zA-Z0-9]{4,16})/i);
  return match?.[1]?.toUpperCase() ?? null;
}

function flowDisplayName(flow: BridgeFlow) {
  switch (flow) {
    case "verification":
      return "verificacion";
    case "login":
      return "inicio de sesion";
    case "register":
      return "registro";
    case "recovery":
      return "recuperacion";
  }
}

export function buildBridgeMessage(flow: BridgeFlow, code: string, otpRef: string) {
  return `Tu codigo de ${flowDisplayName(flow)} es ${code}. REF ${otpRef}`;
}

export function resolveBridgeSessionStatus(
  session: Pick<BridgeSessionRow, "status" | "expires_at">
) {
  if (session.status === "pending" && session.expires_at <= new Date()) {
    return "expired" as const;
  }
  return session.status;
}

function buildVerifiedEventPayload(session: BridgeSessionRow) {
  return {
    event_type: "bridge.session.verified",
    occurred_at: session.verified_at?.toISOString() ?? new Date().toISOString(),
    project_key: session.project_key,
    session: {
      id: session.id,
      flow: session.flow,
      status: session.status,
      phone_e164: session.phone_e164,
      otp_ref: session.otp_ref,
      user_ref: session.user_ref,
      correlation_id: session.correlation_id,
      verified_at: session.verified_at?.toISOString() ?? null,
      expires_at: session.expires_at.toISOString(),
      metadata: session.metadata ?? null
    }
  };
}

export async function createBridgeSession(
  fastify: any,
  input: {
    projectKey: string;
    flow: BridgeFlow;
    phoneE164: string;
    userCode?: string | null;
    userRef?: string | null;
    correlationId?: string | null;
    metadata?: Record<string, unknown> | null;
    callbackUrl?: string | null;
  }
) {
  const store = getBridgeStore(fastify);
  await store.prune();

  const now = new Date();
  return store.createSession({
    id: randomUUID(),
    projectKey: input.projectKey,
    flow: input.flow,
    userRef: input.userRef ?? null,
    correlationId: input.correlationId ?? null,
    phoneE164: input.phoneE164,
    code: input.userCode?.trim() || generateOtpCode(),
    otpRef: generateOtpReference(),
    expiresAt: new Date(now.getTime() + env.BRIDGE_OTP_TTL_SECONDS * 1000),
    callbackUrl: input.callbackUrl ?? null,
    metadata: input.metadata ?? null
  });
}

export async function getBridgeSessionById(fastify: any, projectKey: string, sessionId: string) {
  const store = getBridgeStore(fastify);
  await store.prune();
  const session = await store.getSessionById(sessionId);
  if (!session) return null;
  if (session.project_key !== projectKey) return null;
  return session;
}

export async function refreshBridgeSessionStatus(fastify: any, session: BridgeSessionRow) {
  if (resolveBridgeSessionStatus(session) === "expired" && session.status === "pending") {
    const store = getBridgeStore(fastify);
    const updated = await store.updateSession(session.id, { status: "expired" });
    return updated ?? session;
  }
  return session;
}

export async function enqueueBridgeEvent(
  fastify: any,
  input: {
    session: BridgeSessionRow;
    eventType: string;
    payload: Record<string, unknown>;
  }
) {
  const store = getBridgeStore(fastify);
  await store.prune();
  return store.createEventIfAbsent({
    session: input.session,
    eventType: input.eventType,
    payload: input.payload
  });
}

export async function enqueueBridgeVerifiedEvent(fastify: any, session: BridgeSessionRow) {
  const payload = buildVerifiedEventPayload(session);
  return enqueueBridgeEvent(fastify, {
    session,
    eventType: "bridge.session.verified",
    payload
  });
}

export async function consumeBridgeOtp(
  fastify: any,
  input: {
    from: string;
    otp: string;
    text: string;
  }
) {
  const store = getBridgeStore(fastify);
  await store.prune();

  const now = new Date();
  const otpRef = extractBridgeReference(input.text);
  const pendingByPhone = await store.listPendingSessionsByPhone(input.from);

  let matchedSession: BridgeSessionRow | null = null;
  if (otpRef) {
    matchedSession =
      pendingByPhone.find((session) => session.otp_ref.toUpperCase() === otpRef.toUpperCase()) ??
      null;
  } else {
    matchedSession = pendingByPhone.find((session) => session.code === input.otp) ?? null;
  }

  if (!matchedSession) {
    const latestPending = pendingByPhone[0] ?? null;
    if (!latestPending) {
      return { handled: false as const };
    }

    if (latestPending.expires_at <= now) {
      await store.updateSession(latestPending.id, { status: "expired" });
      return { handled: true as const, status: "expired" as const };
    }

    const nextAttempts = latestPending.attempts + 1;
    const willExpire = nextAttempts >= env.BRIDGE_OTP_MAX_ATTEMPTS;
    await store.updateSession(latestPending.id, {
      attempts: nextAttempts,
      status: willExpire ? "expired" : latestPending.status
    });
    return {
      handled: true as const,
      status: willExpire ? ("expired" as const) : ("invalid" as const)
    };
  }

  if (matchedSession.expires_at <= now) {
    await store.updateSession(matchedSession.id, { status: "expired" });
    return { handled: true as const, status: "expired" as const };
  }

  if (matchedSession.code !== input.otp) {
    const nextAttempts = matchedSession.attempts + 1;
    const willExpire = nextAttempts >= env.BRIDGE_OTP_MAX_ATTEMPTS;
    await store.updateSession(matchedSession.id, {
      attempts: nextAttempts,
      status: willExpire ? "expired" : matchedSession.status
    });
    return {
      handled: true as const,
      status: willExpire ? ("expired" as const) : ("invalid" as const)
    };
  }

  const verified =
    (await store.updateSession(matchedSession.id, {
      status: "verified",
      verified_at: now
    })) ?? matchedSession;
  await enqueueBridgeVerifiedEvent(fastify, verified);
  return {
    handled: true as const,
    status: "verified" as const,
    session: verified
  };
}

export async function verifyBridgeSessionCode(
  fastify: any,
  input: {
    projectKey: string;
    sessionId: string;
    code: string;
  }
) {
  const store = getBridgeStore(fastify);
  const session = await getBridgeSessionById(fastify, input.projectKey, input.sessionId);
  if (!session) {
    return { found: false as const };
  }

  const refreshed = await refreshBridgeSessionStatus(fastify, session);
  if (refreshed.status === "verified") {
    return { found: true as const, status: "verified" as const, session: refreshed };
  }
  if (refreshed.status !== "pending") {
    return { found: true as const, status: "expired" as const, session: refreshed };
  }

  if (refreshed.code !== input.code) {
    const nextAttempts = refreshed.attempts + 1;
    const willExpire = nextAttempts >= env.BRIDGE_OTP_MAX_ATTEMPTS;
    const updated =
      (await store.updateSession(refreshed.id, {
        attempts: nextAttempts,
        status: willExpire ? "expired" : refreshed.status
      })) ?? refreshed;
    return {
      found: true as const,
      status: willExpire ? ("expired" as const) : ("invalid" as const),
      session: updated
    };
  }

  const verified =
    (await store.updateSession(refreshed.id, {
      status: "verified",
      verified_at: new Date()
    })) ?? refreshed;
  await enqueueBridgeVerifiedEvent(fastify, verified);
  return { found: true as const, status: "verified" as const, session: verified };
}

export function buildBridgeSignature(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");
}

function nextRetryDate(attempts: number) {
  const base = env.BRIDGE_EVENT_RETRY_BASE_SECONDS;
  const seconds = Math.min(base * Math.max(1, 2 ** (attempts - 1)), 60 * 60);
  return new Date(Date.now() + seconds * 1000);
}

async function deliverBridgeEvent(fastify: any, event: BridgeSessionEvent) {
  const store = getBridgeStore(fastify);
  const projectConfig = env.bridgeProjects[event.project_key];
  if (!projectConfig) {
    await failEvent(store, event, "project_not_configured");
    return false;
  }

  const callbackUrl = event.callback_url ?? projectConfig.callbackUrl;
  const callbackSecret = projectConfig.callbackSecret;
  if (!callbackUrl || !callbackSecret) {
    await failEvent(store, event, "callback_not_configured");
    return false;
  }

  const payloadText = JSON.stringify(event.payload ?? {});
  const timestamp = String(Date.now());
  const signature = buildBridgeSignature(callbackSecret, timestamp, payloadText);
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.BRIDGE_CALLBACK_TIMEOUT_MS);

  try {
    const response = await fetch(callbackUrl, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-bridge-event-id": String(event.id),
        "x-bridge-event-type": event.event_type,
        "x-bridge-timestamp": timestamp,
        "x-bridge-signature": `sha256=${signature}`
      },
      body: payloadText,
      signal: controller.signal
    });
    clearTimeout(timeout);

    if (!response.ok) {
      const body = await response.text().catch(() => "");
      await failEvent(store, event, `callback_http_${response.status}${body ? `:${body}` : ""}`);
      return false;
    }

    await store.updateEvent(event.id, {
      delivery_status: "delivered",
      delivered_at: new Date(),
      processing_started_at: null
    });
    return true;
  } catch (err: any) {
    clearTimeout(timeout);
    const message =
      err?.name === "AbortError" ? "callback_timeout" : err?.message ?? "callback_failed";
    await failEvent(store, event, message);
    return false;
  }
}

type BridgeSessionEvent = import("./bridge/store.js").BridgeEventRow;

async function failEvent(
  store: import("./bridge/store.js").BridgeStore,
  event: BridgeSessionEvent,
  message: string
) {
  const attempts = event.delivery_attempts + 1;
  const patch: import("./bridge/store.js").BridgeEventPatch = {
    delivery_attempts: attempts,
    last_error: message.slice(0, 1000),
    processing_started_at: null
  };
  if (attempts >= env.BRIDGE_EVENT_MAX_RETRIES) {
    patch.delivery_status = "failed";
  } else {
    patch.delivery_status = "pending";
    patch.next_retry_at = nextRetryDate(attempts);
  }
  await store.updateEvent(event.id, patch);
}

export async function dispatchDueBridgeEvents(
  fastify: any,
  input?: {
    projectKey?: string;
    limit?: number;
  }
) {
  const store = getBridgeStore(fastify);
  await store.prune();

  const limit = Math.min(
    Math.max(1, input?.limit ?? env.BRIDGE_EVENT_DISPATCH_LIMIT),
    env.BRIDGE_EVENT_DISPATCH_LIMIT
  );

  const claimed = await store.claimDueEvents({
    projectKey: input?.projectKey,
    limit,
    now: new Date()
  });

  let delivered = 0;
  let failed = 0;

  for (const event of claimed) {
    await store.updateEvent(event.id, {
      delivery_status: "processing",
      processing_started_at: new Date()
    });

    const ok = await deliverBridgeEvent(fastify, event);
    if (ok) {
      delivered += 1;
    } else {
      failed += 1;
    }
  }

  return {
    claimed: claimed.length,
    delivered,
    failed
  };
}

export async function getBridgeSessionEventStatus(fastify: any, sessionId: string) {
  const store = getBridgeStore(fastify);
  const latest = await store.getLatestEventBySession(sessionId);
  if (!latest) return null;

  return {
    id: latest.id,
    event_type: latest.event_type,
    delivery_status: latest.delivery_status,
    delivery_attempts: latest.delivery_attempts,
    next_retry_at: latest.next_retry_at,
    delivered_at: latest.delivered_at,
    last_error: latest.last_error,
    created_at: latest.created_at
  };
}
