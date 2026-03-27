import { randomUUID } from "node:crypto";
import { env } from "../../config/env.js";
import {
  generateOtpCode,
  generateOtpReference,
  extractBridgeReference,
  resolveBridgeSessionStatus,
  buildBridgeSignature
} from "../../domain/bridge/otp.js";
import { nextRetryAt } from "../../domain/bridge/backoff.js";
import type { BridgeFlow, BridgeSessionRow } from "../../domain/bridge/types.js";
import { getPool } from "../../infrastructure/db/pool.js";
import {
  insertBridgeSession,
  findBridgeSessionById,
  updateBridgeSession,
  findAndLockPendingSessionsByPhone,
  updateBridgeSessionTx,
  insertBridgeEventIfAbsent,
  claimDueBridgeEvents,
  markEventDelivered,
  markEventFailed,
  findLatestEventBySession
} from "../../infrastructure/db/queries/bridge.js";

export async function createBridgeSession(
  _fastify: any,
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
): Promise<BridgeSessionRow> {
  const now = new Date();
  return insertBridgeSession({
    id: randomUUID(),
    project_key: input.projectKey,
    flow: input.flow,
    user_ref: input.userRef ?? null,
    correlation_id: input.correlationId ?? null,
    phone_e164: input.phoneE164,
    code: input.userCode?.trim() || generateOtpCode(),
    otp_ref: generateOtpReference(),
    status: "pending",
    attempts: 0,
    expires_at: new Date(now.getTime() + env.BRIDGE_OTP_TTL_SECONDS * 1000),
    verified_at: null,
    callback_url: input.callbackUrl ?? null,
    metadata: input.metadata ?? null
  });
}

export async function getBridgeSessionById(
  _fastify: any,
  projectKey: string,
  sessionId: string
): Promise<BridgeSessionRow | null> {
  return findBridgeSessionById(projectKey, sessionId);
}

export async function refreshBridgeSessionStatus(
  _fastify: any,
  session: BridgeSessionRow
): Promise<BridgeSessionRow> {
  if (resolveBridgeSessionStatus(session) === "expired" && session.status === "pending") {
    return updateBridgeSession(session.id, { status: "expired" });
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
): Promise<boolean> {
  return insertBridgeEventIfAbsent({
    session_id: input.session.id,
    project_key: input.session.project_key,
    event_type: input.eventType,
    payload: input.payload,
    next_retry_at: new Date()
  });
}

export async function enqueueBridgeVerifiedEvent(fastify: any, session: BridgeSessionRow) {
  const payload = {
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
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const pendingByPhone = await findAndLockPendingSessionsByPhone(client, input.from);

    if (pendingByPhone.length === 0) {
      await client.query("COMMIT");
      return { handled: false as const };
    }

    const now = new Date();
    const otpRef = extractBridgeReference(input.text);

    let matchedSession: BridgeSessionRow | null = null;
    if (otpRef) {
      matchedSession =
        pendingByPhone.find((s) => s.otp_ref.toUpperCase() === otpRef.toUpperCase()) ?? null;
    } else {
      matchedSession = pendingByPhone.find((s) => s.code === input.otp) ?? null;
    }

    if (!matchedSession) {
      const latestPending = pendingByPhone[0];

      if (latestPending.expires_at <= now) {
        await updateBridgeSessionTx(client, latestPending.id, { status: "expired" });
        await client.query("COMMIT");
        return { handled: true as const, status: "expired" as const };
      }

      const newAttempts = latestPending.attempts + 1;
      const willExpire = newAttempts >= env.BRIDGE_OTP_MAX_ATTEMPTS;
      await updateBridgeSessionTx(client, latestPending.id, {
        attempts: newAttempts,
        ...(willExpire ? { status: "expired" as const } : {})
      });
      await client.query("COMMIT");
      return {
        handled: true as const,
        status: willExpire ? ("expired" as const) : ("invalid" as const)
      };
    }

    if (matchedSession.expires_at <= now) {
      await updateBridgeSessionTx(client, matchedSession.id, { status: "expired" });
      await client.query("COMMIT");
      return { handled: true as const, status: "expired" as const };
    }

    if (matchedSession.code !== input.otp) {
      const newAttempts = matchedSession.attempts + 1;
      const willExpire = newAttempts >= env.BRIDGE_OTP_MAX_ATTEMPTS;
      await updateBridgeSessionTx(client, matchedSession.id, {
        attempts: newAttempts,
        ...(willExpire ? { status: "expired" as const } : {})
      });
      await client.query("COMMIT");
      return {
        handled: true as const,
        status: willExpire ? ("expired" as const) : ("invalid" as const)
      };
    }

    const verifiedAt = new Date();
    const verifiedSession = await updateBridgeSessionTx(client, matchedSession.id, {
      status: "verified",
      verified_at: verifiedAt
    });
    await client.query("COMMIT");

    await enqueueBridgeVerifiedEvent(fastify, verifiedSession);
    return {
      handled: true as const,
      status: "verified" as const,
      session: verifiedSession
    };
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function verifyBridgeSessionCode(
  fastify: any,
  input: {
    projectKey: string;
    sessionId: string;
    code: string;
  }
) {
  const session = await findBridgeSessionById(input.projectKey, input.sessionId);
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
    const newAttempts = refreshed.attempts + 1;
    const willExpire = newAttempts >= env.BRIDGE_OTP_MAX_ATTEMPTS;
    const updated = await updateBridgeSession(refreshed.id, {
      attempts: newAttempts,
      ...(willExpire ? { status: "expired" as const } : {})
    });
    return {
      found: true as const,
      status: willExpire ? ("expired" as const) : ("invalid" as const),
      session: updated
    };
  }

  const verified = await updateBridgeSession(refreshed.id, {
    status: "verified",
    verified_at: new Date()
  });
  await enqueueBridgeVerifiedEvent(fastify, verified);
  return { found: true as const, status: "verified" as const, session: verified };
}

export async function dispatchDueBridgeEvents(
  _fastify: any,
  input?: {
    projectKey?: string;
    limit?: number;
  }
) {
  const limit = Math.min(
    Math.max(1, input?.limit ?? env.BRIDGE_EVENT_DISPATCH_LIMIT),
    env.BRIDGE_EVENT_DISPATCH_LIMIT
  );

  const events = await claimDueBridgeEvents(input?.projectKey, limit);

  let delivered = 0;
  let failed = 0;

  for (const event of events) {
    const ok = await deliverBridgeEvent(event);
    if (ok) {
      delivered += 1;
    } else {
      failed += 1;
    }
  }

  return {
    claimed: events.length,
    delivered,
    failed
  };
}

async function deliverBridgeEvent(event: Awaited<ReturnType<typeof claimDueBridgeEvents>>[number]) {
  const projectConfig = env.bridgeProjects[event.project_key];
  if (!projectConfig) {
    await markEventFailed(event.id, "project_not_configured", null, "failed");
    return false;
  }

  const callbackUrl = event.session_callback_url ?? projectConfig.callbackUrl;
  const callbackSecret = projectConfig.callbackSecret;
  if (!callbackUrl || !callbackSecret) {
    await markEventFailed(event.id, "callback_not_configured", null, "failed");
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
      const errMsg = `callback_http_${response.status}${body ? `:${body}` : ""}`;
      const newAttempts = event.delivery_attempts + 1;
      const isFinal = newAttempts >= env.BRIDGE_EVENT_MAX_RETRIES;
      await markEventFailed(
        event.id,
        errMsg,
        isFinal ? null : nextRetryAt(newAttempts),
        isFinal ? "failed" : "pending"
      );
      return false;
    }

    await markEventDelivered(event.id);
    return true;
  } catch (err: any) {
    clearTimeout(timeout);
    const message = err?.name === "AbortError" ? "callback_timeout" : err?.message ?? "callback_failed";
    const newAttempts = event.delivery_attempts + 1;
    const isFinal = newAttempts >= env.BRIDGE_EVENT_MAX_RETRIES;
    await markEventFailed(
      event.id,
      message,
      isFinal ? null : nextRetryAt(newAttempts),
      isFinal ? "failed" : "pending"
    );
    return false;
  }
}

export async function getBridgeSessionEventStatus(_fastify: any, sessionId: string) {
  return findLatestEventBySession(sessionId);
}
