import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export const BRIDGE_FLOWS = ["verification", "login", "register", "recovery"] as const;
export type BridgeFlow = (typeof BRIDGE_FLOWS)[number];

type BridgeSessionStatus = "pending" | "verified" | "expired" | "cancelled";
type BridgeEventStatus = "pending" | "processing" | "delivered" | "failed";

export type BridgeSessionRow = {
  id: string;
  project_key: string;
  flow: BridgeFlow;
  user_ref: string | null;
  correlation_id: string | null;
  phone_e164: string;
  code: string;
  otp_ref: string;
  status: BridgeSessionStatus;
  attempts: number;
  expires_at: Date;
  verified_at: Date | null;
  callback_url: string | null;
  metadata: Record<string, unknown> | null;
  created_at: Date;
  updated_at: Date;
};

type BridgeEventRow = {
  id: number;
  session_id: string;
  project_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  delivery_status: BridgeEventStatus;
  delivery_attempts: number;
  next_retry_at: Date;
  processing_started_at: Date | null;
  callback_url: string | null;
  delivered_at: Date | null;
  last_error: string | null;
  created_at: Date;
  updated_at: Date;
};

const sessionsById = new Map<string, BridgeSessionRow>();
const eventsById = new Map<number, BridgeEventRow>();
const eventKeyIndex = new Map<string, number>();
let bridgeEventSequence = 1;

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

function eventUniqueKey(sessionId: string, eventType: string) {
  return `${sessionId}:${eventType}`;
}

function sessionRetentionMs() {
  const ttlMs = env.BRIDGE_OTP_TTL_SECONDS * 1000;
  return Math.max(ttlMs * 3, 24 * 60 * 60 * 1000);
}

function pruneBridgeMemory() {
  const now = Date.now();
  const retention = sessionRetentionMs();

  for (const [sessionId, session] of sessionsById.entries()) {
    const finished = session.status !== "pending";
    const stalePending = session.status === "pending" && session.expires_at.getTime() + retention <= now;
    const staleFinished = finished && session.updated_at.getTime() + retention <= now;
    if (!stalePending && !staleFinished) continue;

    sessionsById.delete(sessionId);

    for (const [eventId, event] of eventsById.entries()) {
      if (event.session_id !== sessionId) continue;
      eventsById.delete(eventId);
      eventKeyIndex.delete(eventUniqueKey(sessionId, event.event_type));
    }
  }
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

export function resolveBridgeSessionStatus(session: Pick<BridgeSessionRow, "status" | "expires_at">) {
  if (session.status === "pending" && session.expires_at <= new Date()) {
    return "expired" as const;
  }
  return session.status;
}

function expireSession(session: BridgeSessionRow) {
  session.status = "expired";
  session.updated_at = new Date();
}

function increaseSessionAttempts(session: BridgeSessionRow) {
  session.attempts += 1;
  session.updated_at = new Date();
  if (session.attempts >= env.BRIDGE_OTP_MAX_ATTEMPTS) {
    session.status = "expired";
  }
}

function markSessionVerified(session: BridgeSessionRow) {
  const now = new Date();
  session.status = "verified";
  session.verified_at = now;
  session.updated_at = now;
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
  _fastify: any,
  input: {
    projectKey: string;
    flow: BridgeFlow;
    phoneE164: string;
    userRef?: string | null;
    correlationId?: string | null;
    metadata?: Record<string, unknown> | null;
    callbackUrl?: string | null;
  }
) {
  pruneBridgeMemory();

  const now = new Date();
  const session: BridgeSessionRow = {
    id: randomUUID(),
    project_key: input.projectKey,
    flow: input.flow,
    user_ref: input.userRef ?? null,
    correlation_id: input.correlationId ?? null,
    phone_e164: input.phoneE164,
    code: generateOtpCode(),
    otp_ref: generateOtpReference(),
    status: "pending",
    attempts: 0,
    expires_at: new Date(now.getTime() + env.BRIDGE_OTP_TTL_SECONDS * 1000),
    verified_at: null,
    callback_url: input.callbackUrl ?? null,
    metadata: input.metadata ?? null,
    created_at: now,
    updated_at: now
  };

  sessionsById.set(session.id, session);
  return session;
}

export async function getBridgeSessionById(_fastify: any, projectKey: string, sessionId: string) {
  pruneBridgeMemory();
  const session = sessionsById.get(sessionId);
  if (!session) return null;
  if (session.project_key !== projectKey) return null;
  return session;
}

export async function refreshBridgeSessionStatus(_fastify: any, session: BridgeSessionRow) {
  if (resolveBridgeSessionStatus(session) === "expired" && session.status === "pending") {
    expireSession(session);
  }
  return session;
}

export async function enqueueBridgeEvent(
  _fastify: any,
  input: {
    session: BridgeSessionRow;
    eventType: string;
    payload: Record<string, unknown>;
  }
) {
  pruneBridgeMemory();

  const key = eventUniqueKey(input.session.id, input.eventType);
  if (eventKeyIndex.has(key)) {
    return false;
  }

  const now = new Date();
  const event: BridgeEventRow = {
    id: bridgeEventSequence++,
    session_id: input.session.id,
    project_key: input.session.project_key,
    event_type: input.eventType,
    payload: input.payload,
    delivery_status: "pending",
    delivery_attempts: 0,
    next_retry_at: now,
    processing_started_at: null,
    callback_url: input.session.callback_url,
    delivered_at: null,
    last_error: null,
    created_at: now,
    updated_at: now
  };

  eventsById.set(event.id, event);
  eventKeyIndex.set(key, event.id);
  return true;
}

export async function enqueueBridgeVerifiedEvent(fastify: any, session: BridgeSessionRow) {
  const payload = buildVerifiedEventPayload(session);
  return enqueueBridgeEvent(fastify, {
    session,
    eventType: "bridge.session.verified",
    payload
  });
}

function latestPendingSessionsByPhone(phoneE164: string) {
  return Array.from(sessionsById.values())
    .filter((session) => session.phone_e164 === phoneE164 && session.status === "pending")
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
}

export async function consumeBridgeOtp(
  fastify: any,
  input: {
    from: string;
    otp: string;
    text: string;
  }
) {
  pruneBridgeMemory();

  const now = new Date();
  const otpRef = extractBridgeReference(input.text);
  const pendingByPhone = latestPendingSessionsByPhone(input.from);

  let matchedSession: BridgeSessionRow | null = null;
  if (otpRef) {
    matchedSession =
      pendingByPhone.find((session) => session.otp_ref.toUpperCase() === otpRef.toUpperCase()) ?? null;
  } else {
    matchedSession = pendingByPhone.find((session) => session.code === input.otp) ?? null;
  }

  if (!matchedSession) {
    const latestPending = pendingByPhone[0] ?? null;
    if (!latestPending) {
      return { handled: false as const };
    }

    if (latestPending.expires_at <= now) {
      expireSession(latestPending);
      return { handled: true as const, status: "expired" as const };
    }

    const willExpire = latestPending.attempts + 1 >= env.BRIDGE_OTP_MAX_ATTEMPTS;
    increaseSessionAttempts(latestPending);
    return {
      handled: true as const,
      status: willExpire ? ("expired" as const) : ("invalid" as const)
    };
  }

  if (matchedSession.expires_at <= now) {
    expireSession(matchedSession);
    return { handled: true as const, status: "expired" as const };
  }

  if (matchedSession.code !== input.otp) {
    const willExpire = matchedSession.attempts + 1 >= env.BRIDGE_OTP_MAX_ATTEMPTS;
    increaseSessionAttempts(matchedSession);
    return {
      handled: true as const,
      status: willExpire ? ("expired" as const) : ("invalid" as const)
    };
  }

  markSessionVerified(matchedSession);
  await enqueueBridgeVerifiedEvent(fastify, matchedSession);
  return {
    handled: true as const,
    status: "verified" as const,
    session: matchedSession
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
  const session = await getBridgeSessionById(fastify, input.projectKey, input.sessionId);
  if (!session) {
    return { found: false as const };
  }

  await refreshBridgeSessionStatus(fastify, session);
  if (session.status === "verified") {
    return { found: true as const, status: "verified" as const, session };
  }
  if (session.status !== "pending") {
    return { found: true as const, status: "expired" as const, session };
  }

  if (session.code !== input.code) {
    const willExpire = session.attempts + 1 >= env.BRIDGE_OTP_MAX_ATTEMPTS;
    increaseSessionAttempts(session);
    return {
      found: true as const,
      status: willExpire ? ("expired" as const) : ("invalid" as const),
      session
    };
  }

  markSessionVerified(session);
  await enqueueBridgeVerifiedEvent(fastify, session);
  return { found: true as const, status: "verified" as const, session };
}

export function buildBridgeSignature(secret: string, timestamp: string, rawBody: string) {
  return createHmac("sha256", secret)
    .update(`${timestamp}.${rawBody}`)
    .digest("hex");
}

function nextRetryDate(attempts: number) {
  const base = env.BRIDGE_EVENT_RETRY_BASE_SECONDS;
  const seconds = Math.min(base * Math.max(1, 2 ** (attempts - 1)), 60 * 60);
  return new Date(Date.now() + seconds * 1000);
}

function markBridgeEventDelivered(event: BridgeEventRow) {
  event.delivery_status = "delivered";
  event.delivered_at = new Date();
  event.processing_started_at = null;
  event.updated_at = new Date();
}

function markBridgeEventFailed(event: BridgeEventRow, message: string) {
  const attempts = event.delivery_attempts + 1;
  event.delivery_attempts = attempts;
  event.last_error = message.slice(0, 1000);
  event.processing_started_at = null;
  event.updated_at = new Date();

  if (attempts >= env.BRIDGE_EVENT_MAX_RETRIES) {
    event.delivery_status = "failed";
    return;
  }

  event.delivery_status = "pending";
  event.next_retry_at = nextRetryDate(attempts);
}

async function deliverBridgeEvent(event: BridgeEventRow) {
  const projectConfig = env.bridgeProjects[event.project_key];
  if (!projectConfig) {
    markBridgeEventFailed(event, "project_not_configured");
    return false;
  }

  const callbackUrl = event.callback_url ?? projectConfig.callbackUrl;
  const callbackSecret = projectConfig.callbackSecret;
  if (!callbackUrl || !callbackSecret) {
    markBridgeEventFailed(event, "callback_not_configured");
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
      markBridgeEventFailed(event, `callback_http_${response.status}${body ? `:${body}` : ""}`);
      return false;
    }

    markBridgeEventDelivered(event);
    return true;
  } catch (err: any) {
    clearTimeout(timeout);
    const message = err?.name === "AbortError" ? "callback_timeout" : err?.message ?? "callback_failed";
    markBridgeEventFailed(event, message);
    return false;
  }
}

export async function dispatchDueBridgeEvents(
  _fastify: any,
  input?: {
    projectKey?: string;
    limit?: number;
  }
) {
  pruneBridgeMemory();

  const limit = Math.min(
    Math.max(1, input?.limit ?? env.BRIDGE_EVENT_DISPATCH_LIMIT),
    env.BRIDGE_EVENT_DISPATCH_LIMIT
  );

  const now = Date.now();
  const claimed = Array.from(eventsById.values())
    .filter((event) => {
      if (event.delivery_status !== "pending") return false;
      if (event.next_retry_at.getTime() > now) return false;
      if (input?.projectKey && event.project_key !== input.projectKey) return false;
      return true;
    })
    .sort((a, b) => {
      const byRetry = a.next_retry_at.getTime() - b.next_retry_at.getTime();
      if (byRetry !== 0) return byRetry;
      return a.id - b.id;
    })
    .slice(0, limit);

  let delivered = 0;
  let failed = 0;

  for (const event of claimed) {
    event.delivery_status = "processing";
    event.processing_started_at = new Date();
    event.updated_at = new Date();

    const ok = await deliverBridgeEvent(event);
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

export async function getBridgeSessionEventStatus(_fastify: any, sessionId: string) {
  const latest = Array.from(eventsById.values())
    .filter((event) => event.session_id === sessionId)
    .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0];

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
