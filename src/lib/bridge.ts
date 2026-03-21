import { createHmac, randomInt, randomUUID, timingSafeEqual } from "node:crypto";
import { env } from "../env.js";

export const BRIDGE_FLOWS = ["verification", "login", "register", "recovery"] as const;
export type BridgeFlow = (typeof BRIDGE_FLOWS)[number];

export type BridgeSessionRow = {
  id: string;
  project_key: string;
  flow: BridgeFlow;
  user_ref: string | null;
  correlation_id: string | null;
  phone_e164: string;
  code: string;
  otp_ref: string;
  status: "pending" | "verified" | "expired" | "cancelled";
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
  delivery_status: "pending" | "processing" | "delivered" | "failed";
  delivery_attempts: number;
  next_retry_at: Date;
  processing_started_at: Date | null;
  callback_url: string | null;
};

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
  return String(randomInt(1000, 10000));
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
  return `Hola, mi codigo de ${flowDisplayName(flow)} es ${code}. REF ${otpRef}`;
}

export function resolveBridgeSessionStatus(session: Pick<BridgeSessionRow, "status" | "expires_at">) {
  if (session.status === "pending" && session.expires_at <= new Date()) {
    return "expired" as const;
  }
  return session.status;
}

export async function createBridgeSession(
  fastify: any,
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
  const code = generateOtpCode();
  const otpRef = generateOtpReference();
  const ttlMs = env.BRIDGE_OTP_TTL_SECONDS * 1000;
  const expiresAt = new Date(Date.now() + ttlMs);

  const { rows } = await fastify.pg.query(
    `insert into whatsapp_bridge_sessions (
       project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, expires_at, metadata, callback_url
     )
     values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     returning id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata, created_at, updated_at`,
    [
      input.projectKey,
      input.flow,
      input.userRef ?? null,
      input.correlationId ?? null,
      input.phoneE164,
      code,
      otpRef,
      expiresAt,
      input.metadata ?? null,
      input.callbackUrl ?? null
    ]
  );

  return rows[0] as BridgeSessionRow;
}

export async function getBridgeSessionById(fastify: any, projectKey: string, sessionId: string) {
  const { rows } = await fastify.pg.query(
    `select id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata, created_at, updated_at
     from whatsapp_bridge_sessions
     where id = $1 and project_key = $2
     limit 1`,
    [sessionId, projectKey]
  );
  return (rows[0] as BridgeSessionRow | undefined) ?? null;
}

export async function refreshBridgeSessionStatus(fastify: any, session: BridgeSessionRow) {
  if (resolveBridgeSessionStatus(session) !== "expired") {
    return session;
  }
  const { rows } = await fastify.pg.query(
    `update whatsapp_bridge_sessions
     set status = 'expired',
         updated_at = now()
     where id = $1
       and status = 'pending'
     returning id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata, created_at, updated_at`,
    [session.id]
  );
  return (rows[0] as BridgeSessionRow | undefined) ?? session;
}

async function expireBridgeSession(fastify: any, sessionId: string) {
  await fastify.pg.query(
    `update whatsapp_bridge_sessions
     set status = 'expired',
         updated_at = now()
     where id = $1
       and status = 'pending'`,
    [sessionId]
  );
}

async function increaseBridgeAttempts(fastify: any, sessionId: string) {
  await fastify.pg.query(
    `update whatsapp_bridge_sessions
     set attempts = attempts + 1,
         status = case when attempts + 1 >= $2 then 'expired' else status end,
         updated_at = now()
     where id = $1
       and status = 'pending'`,
    [sessionId, env.BRIDGE_OTP_MAX_ATTEMPTS]
  );
}

async function markBridgeSessionVerified(fastify: any, sessionId: string) {
  const { rows } = await fastify.pg.query(
    `update whatsapp_bridge_sessions
     set status = 'verified',
         verified_at = now(),
         updated_at = now()
     where id = $1
       and status = 'pending'
     returning id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata, created_at, updated_at`,
    [sessionId]
  );
  return (rows[0] as BridgeSessionRow | undefined) ?? null;
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

export async function enqueueBridgeEvent(
  fastify: any,
  input: {
    session: BridgeSessionRow;
    eventType: string;
    payload: Record<string, unknown>;
  }
) {
  const { rows } = await fastify.pg.query(
    `insert into whatsapp_bridge_events (session_id, project_key, event_type, payload)
     values ($1, $2, $3, $4::jsonb)
     on conflict (session_id, event_type) do nothing
     returning id`,
    [input.session.id, input.session.project_key, input.eventType, JSON.stringify(input.payload)]
  );
  return rows.length > 0;
}

export async function enqueueBridgeVerifiedEvent(fastify: any, session: BridgeSessionRow) {
  const payload = buildVerifiedEventPayload(session);
  return enqueueBridgeEvent(fastify, {
    session,
    eventType: "bridge.session.verified",
    payload
  });
}

function parseBridgeSession(row: any) {
  return row as BridgeSessionRow;
}

export async function consumeBridgeOtp(
  fastify: any,
  input: {
    from: string;
    otp: string;
    text: string;
  }
) {
  const otpRef = extractBridgeReference(input.text);
  const now = new Date();

  let matchedSession: BridgeSessionRow | null = null;
  if (otpRef) {
    const { rows } = await fastify.pg.query(
      `select id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata, created_at, updated_at
       from whatsapp_bridge_sessions
       where phone_e164 = $1
         and otp_ref = $2
         and status = 'pending'
       order by created_at desc
       limit 1`,
      [input.from, otpRef]
    );
    matchedSession = rows[0] ? parseBridgeSession(rows[0]) : null;
  } else {
    const { rows } = await fastify.pg.query(
      `select id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata, created_at, updated_at
       from whatsapp_bridge_sessions
       where phone_e164 = $1
         and code = $2
         and status = 'pending'
       order by created_at desc
       limit 1`,
      [input.from, input.otp]
    );
    matchedSession = rows[0] ? parseBridgeSession(rows[0]) : null;
  }

  if (!matchedSession) {
    const { rows } = await fastify.pg.query(
      `select id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata, created_at, updated_at
       from whatsapp_bridge_sessions
       where phone_e164 = $1
         and status = 'pending'
       order by created_at desc
       limit 1`,
      [input.from]
    );
    const latestPending = rows[0] ? parseBridgeSession(rows[0]) : null;
    if (!latestPending) {
      return { handled: false as const };
    }

    if (latestPending.expires_at <= now) {
      await expireBridgeSession(fastify, latestPending.id);
      return {
        handled: true as const,
        status: "expired" as const
      };
    }

    await increaseBridgeAttempts(fastify, latestPending.id);
    return {
      handled: true as const,
      status: "invalid" as const
    };
  }

  if (matchedSession.expires_at <= now) {
    await expireBridgeSession(fastify, matchedSession.id);
    return {
      handled: true as const,
      status: "expired" as const
    };
  }

  if (matchedSession.code !== input.otp) {
    await increaseBridgeAttempts(fastify, matchedSession.id);
    return {
      handled: true as const,
      status: "invalid" as const
    };
  }

  const verified = await markBridgeSessionVerified(fastify, matchedSession.id);
  if (!verified) {
    return {
      handled: true as const,
      status: "invalid" as const
    };
  }

  await enqueueBridgeVerifiedEvent(fastify, verified);
  return {
    handled: true as const,
    status: "verified" as const,
    session: verified
  };
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

async function claimDueBridgeEvents(
  fastify: any,
  input: {
    projectKey?: string;
    limit: number;
  }
) {
  const values: any[] = [];
  let projectFilter = "";
  if (input.projectKey) {
    values.push(input.projectKey);
    projectFilter = `and project_key = $${values.length}`;
  }
  values.push(input.limit);
  const limitParam = `$${values.length}`;

  await fastify.pg.query("begin");
  try {
    await fastify.pg.query(
      `update whatsapp_bridge_events
       set delivery_status = 'pending',
           processing_started_at = null,
           updated_at = now()
       where delivery_status = 'processing'
         and processing_started_at is not null
         and processing_started_at < now() - interval '10 minutes'`
    );

    const { rows } = await fastify.pg.query(
      `with picked as (
         select id
         from whatsapp_bridge_events
         where delivery_status = 'pending'
           and next_retry_at <= now()
           ${projectFilter}
         order by next_retry_at asc
         limit ${limitParam}
         for update skip locked
       )
       update whatsapp_bridge_events e
       set delivery_status = 'processing',
           processing_started_at = now(),
           updated_at = now()
       from picked
       where e.id = picked.id
       returning e.id, e.session_id, e.project_key, e.event_type, e.payload, e.delivery_status, e.delivery_attempts, e.next_retry_at, e.processing_started_at`,
      values
    );

    await fastify.pg.query("commit");

    const claimed = [] as BridgeEventRow[];
    for (const row of rows) {
      const { rows: sessionRows } = await fastify.pg.query(
        `select callback_url
         from whatsapp_bridge_sessions
         where id = $1
         limit 1`,
        [row.session_id]
      );
      claimed.push({
        ...(row as BridgeEventRow),
        callback_url: (sessionRows[0] as { callback_url: string | null } | undefined)?.callback_url ?? null
      });
    }
    return claimed;
  } catch (err) {
    await fastify.pg.query("rollback");
    throw err;
  }
}

async function markBridgeEventDelivered(fastify: any, eventId: number) {
  await fastify.pg.query(
    `update whatsapp_bridge_events
     set delivery_status = 'delivered',
         delivered_at = now(),
         processing_started_at = null,
         updated_at = now()
     where id = $1`,
    [eventId]
  );
}

async function markBridgeEventFailed(fastify: any, event: BridgeEventRow, message: string) {
  const attempts = event.delivery_attempts + 1;
  const reachedMax = attempts >= env.BRIDGE_EVENT_MAX_RETRIES;
  const status = reachedMax ? "failed" : "pending";
  const nextRetryAt = reachedMax ? null : nextRetryDate(attempts);

  await fastify.pg.query(
    `update whatsapp_bridge_events
     set delivery_status = $2,
         delivery_attempts = $3,
         next_retry_at = coalesce($4, next_retry_at),
         last_error = $5,
         processing_started_at = null,
         updated_at = now()
     where id = $1`,
    [event.id, status, attempts, nextRetryAt, message.slice(0, 1000)]
  );
}

async function deliverBridgeEvent(fastify: any, event: BridgeEventRow) {
  const projectConfig = env.bridgeProjects[event.project_key];
  if (!projectConfig) {
    await markBridgeEventFailed(fastify, event, "project_not_configured");
    return false;
  }

  const callbackUrl = event.callback_url ?? projectConfig.callbackUrl;
  const callbackSecret = projectConfig.callbackSecret;
  if (!callbackUrl || !callbackSecret) {
    await markBridgeEventFailed(fastify, event, "callback_not_configured");
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
      await markBridgeEventFailed(
        fastify,
        event,
        `callback_http_${response.status}${body ? `:${body}` : ""}`
      );
      return false;
    }

    await markBridgeEventDelivered(fastify, event.id);
    return true;
  } catch (err: any) {
    clearTimeout(timeout);
    const message = err?.name === "AbortError" ? "callback_timeout" : err?.message ?? "callback_failed";
    await markBridgeEventFailed(fastify, event, message);
    return false;
  }
}

export async function dispatchDueBridgeEvents(
  fastify: any,
  input?: {
    projectKey?: string;
    limit?: number;
  }
) {
  const limit = Math.min(
    Math.max(1, input?.limit ?? env.BRIDGE_EVENT_DISPATCH_LIMIT),
    env.BRIDGE_EVENT_DISPATCH_LIMIT
  );
  const claimed = await claimDueBridgeEvents(fastify, {
    projectKey: input?.projectKey,
    limit
  });

  let delivered = 0;
  let failed = 0;
  for (const event of claimed) {
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
  const { rows } = await fastify.pg.query(
    `select id, event_type, delivery_status, delivery_attempts, next_retry_at, delivered_at, last_error, created_at
     from whatsapp_bridge_events
     where session_id = $1
     order by created_at desc
     limit 1`,
    [sessionId]
  );
  return (
    (rows[0] as
      | {
          id: number;
          event_type: string;
          delivery_status: string;
          delivery_attempts: number;
          next_retry_at: Date;
          delivered_at: Date | null;
          last_error: string | null;
          created_at: Date;
        }
      | undefined) ?? null
  );
}
