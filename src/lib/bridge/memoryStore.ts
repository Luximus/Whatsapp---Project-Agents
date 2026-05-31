import { env } from "../../env.js";
import type {
  BridgeEventPatch,
  BridgeEventRow,
  BridgeSessionPatch,
  BridgeSessionRow,
  BridgeStore,
  CreateBridgeEventInput,
  CreateBridgeSessionInput
} from "./store.js";

/**
 * Implementación en memoria (comportamiento histórico del Bridge).
 * Los datos se pierden al reiniciar el proceso; pensado para single-instance.
 */
export class MemoryBridgeStore implements BridgeStore {
  private sessionsById = new Map<string, BridgeSessionRow>();
  private eventsById = new Map<number, BridgeEventRow>();
  private eventKeyIndex = new Map<string, number>();
  private sequence = 1;

  private retentionMs() {
    const ttlMs = env.BRIDGE_OTP_TTL_SECONDS * 1000;
    return Math.max(ttlMs * 3, 24 * 60 * 60 * 1000);
  }

  private eventKey(sessionId: string, eventType: string) {
    return `${sessionId}:${eventType}`;
  }

  async prune(): Promise<void> {
    const now = Date.now();
    const retention = this.retentionMs();

    for (const [sessionId, session] of this.sessionsById.entries()) {
      const finished = session.status !== "pending";
      const stalePending =
        session.status === "pending" && session.expires_at.getTime() + retention <= now;
      const staleFinished = finished && session.updated_at.getTime() + retention <= now;
      if (!stalePending && !staleFinished) continue;

      this.sessionsById.delete(sessionId);
      for (const [eventId, event] of this.eventsById.entries()) {
        if (event.session_id !== sessionId) continue;
        this.eventsById.delete(eventId);
        this.eventKeyIndex.delete(this.eventKey(sessionId, event.event_type));
      }
    }
  }

  async createSession(input: CreateBridgeSessionInput): Promise<BridgeSessionRow> {
    const now = new Date();
    const session: BridgeSessionRow = {
      id: input.id,
      project_key: input.projectKey,
      flow: input.flow,
      user_ref: input.userRef,
      correlation_id: input.correlationId,
      phone_e164: input.phoneE164,
      code: input.code,
      otp_ref: input.otpRef,
      status: "pending",
      attempts: 0,
      expires_at: input.expiresAt,
      verified_at: null,
      callback_url: input.callbackUrl,
      metadata: input.metadata,
      created_at: now,
      updated_at: now
    };
    this.sessionsById.set(session.id, session);
    return session;
  }

  async getSessionById(sessionId: string): Promise<BridgeSessionRow | null> {
    return this.sessionsById.get(sessionId) ?? null;
  }

  async updateSession(
    sessionId: string,
    patch: BridgeSessionPatch
  ): Promise<BridgeSessionRow | null> {
    const session = this.sessionsById.get(sessionId);
    if (!session) return null;
    if (patch.status !== undefined) session.status = patch.status;
    if (patch.attempts !== undefined) session.attempts = patch.attempts;
    if (patch.verified_at !== undefined) session.verified_at = patch.verified_at;
    session.updated_at = new Date();
    return session;
  }

  async listPendingSessionsByPhone(phoneE164: string): Promise<BridgeSessionRow[]> {
    return Array.from(this.sessionsById.values())
      .filter((session) => session.phone_e164 === phoneE164 && session.status === "pending")
      .sort((a, b) => b.created_at.getTime() - a.created_at.getTime());
  }

  async createEventIfAbsent(input: CreateBridgeEventInput): Promise<boolean> {
    const key = this.eventKey(input.session.id, input.eventType);
    if (this.eventKeyIndex.has(key)) return false;

    const now = new Date();
    const event: BridgeEventRow = {
      id: this.sequence++,
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
    this.eventsById.set(event.id, event);
    this.eventKeyIndex.set(key, event.id);
    return true;
  }

  async updateEvent(eventId: number, patch: BridgeEventPatch): Promise<BridgeEventRow | null> {
    const event = this.eventsById.get(eventId);
    if (!event) return null;
    Object.assign(event, patch);
    event.updated_at = new Date();
    return event;
  }

  async claimDueEvents(input: {
    projectKey?: string;
    limit: number;
    now: Date;
  }): Promise<BridgeEventRow[]> {
    const nowMs = input.now.getTime();
    return Array.from(this.eventsById.values())
      .filter((event) => {
        if (event.delivery_status !== "pending") return false;
        if (event.next_retry_at.getTime() > nowMs) return false;
        if (input.projectKey && event.project_key !== input.projectKey) return false;
        return true;
      })
      .sort((a, b) => {
        const byRetry = a.next_retry_at.getTime() - b.next_retry_at.getTime();
        if (byRetry !== 0) return byRetry;
        return a.id - b.id;
      })
      .slice(0, input.limit);
  }

  async getLatestEventBySession(sessionId: string): Promise<BridgeEventRow | null> {
    return (
      Array.from(this.eventsById.values())
        .filter((event) => event.session_id === sessionId)
        .sort((a, b) => b.created_at.getTime() - a.created_at.getTime())[0] ?? null
    );
  }
}
