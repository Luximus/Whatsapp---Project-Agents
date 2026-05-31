import { env } from "../../env.js";
import type {
  BridgeEventPatch,
  BridgeEventRow,
  BridgeFlow,
  BridgeSessionPatch,
  BridgeSessionRow,
  BridgeStore,
  CreateBridgeEventInput,
  CreateBridgeSessionInput
} from "./store.js";

/** Mínimo de la API de `pg.Pool` que necesitamos (facilita el mock en tests). */
export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

const SESSION_COLUMNS = `id, project_key, flow, user_ref, correlation_id, phone_e164, code,
  otp_ref, status, attempts, expires_at, verified_at, callback_url, metadata,
  created_at, updated_at`;

const EVENT_COLUMNS = `id, session_id, project_key, event_type, payload, delivery_status,
  delivery_attempts, next_retry_at, processing_started_at, callback_url, delivered_at,
  last_error, created_at, updated_at`;

function mapSession(row: any): BridgeSessionRow {
  return {
    id: String(row.id),
    project_key: String(row.project_key),
    flow: row.flow as BridgeFlow,
    user_ref: row.user_ref ?? null,
    correlation_id: row.correlation_id ?? null,
    phone_e164: String(row.phone_e164),
    code: String(row.code),
    otp_ref: String(row.otp_ref),
    status: row.status,
    attempts: Number(row.attempts),
    expires_at: new Date(row.expires_at),
    verified_at: row.verified_at ? new Date(row.verified_at) : null,
    callback_url: row.callback_url ?? null,
    metadata: row.metadata ?? null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at)
  };
}

function mapEvent(row: any): BridgeEventRow {
  return {
    id: Number(row.id),
    session_id: String(row.session_id),
    project_key: String(row.project_key),
    event_type: String(row.event_type),
    payload: row.payload ?? {},
    delivery_status: row.delivery_status,
    delivery_attempts: Number(row.delivery_attempts),
    next_retry_at: new Date(row.next_retry_at),
    processing_started_at: row.processing_started_at ? new Date(row.processing_started_at) : null,
    callback_url: row.callback_url ?? null,
    delivered_at: row.delivered_at ? new Date(row.delivered_at) : null,
    last_error: row.last_error ?? null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at)
  };
}

/**
 * Persistencia en PostgreSQL sobre `whatsapp_bridge_sessions` y
 * `whatsapp_bridge_events` (ver db/schema.sql). Nota: la tabla de eventos NO
 * tiene columna `processing_started_at` en el schema base; el patch de ese
 * campo se ignora a nivel SQL (se mantiene en la interfaz por compatibilidad
 * con el store en memoria).
 */
export class PostgresBridgeStore implements BridgeStore {
  constructor(private readonly pg: PgLike) {}

  private retentionInterval() {
    const seconds = Math.max(env.BRIDGE_OTP_TTL_SECONDS * 3, 24 * 60 * 60);
    return `${seconds} seconds`;
  }

  async prune(): Promise<void> {
    // Eventos se borran en cascada al borrar la sesión (FK on delete cascade).
    await this.pg.query(
      `delete from whatsapp_bridge_sessions
       where (status = 'pending' and expires_at + ($1)::interval <= now())
          or (status <> 'pending' and updated_at + ($1)::interval <= now())`,
      [this.retentionInterval()]
    );
  }

  async createSession(input: CreateBridgeSessionInput): Promise<BridgeSessionRow> {
    const { rows } = await this.pg.query(
      `insert into whatsapp_bridge_sessions
         (id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref,
          status, attempts, expires_at, callback_url, metadata)
       values ($1,$2,$3,$4,$5,$6,$7,$8,'pending',0,$9,$10,$11)
       returning ${SESSION_COLUMNS}`,
      [
        input.id,
        input.projectKey,
        input.flow,
        input.userRef,
        input.correlationId,
        input.phoneE164,
        input.code,
        input.otpRef,
        input.expiresAt,
        input.callbackUrl,
        input.metadata ? JSON.stringify(input.metadata) : null
      ]
    );
    return mapSession(rows[0]);
  }

  async getSessionById(sessionId: string): Promise<BridgeSessionRow | null> {
    const { rows } = await this.pg.query(
      `select ${SESSION_COLUMNS} from whatsapp_bridge_sessions where id = $1 limit 1`,
      [sessionId]
    );
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async updateSession(
    sessionId: string,
    patch: BridgeSessionPatch
  ): Promise<BridgeSessionRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    if (patch.status !== undefined) {
      sets.push(`status = $${i++}`);
      values.push(patch.status);
    }
    if (patch.attempts !== undefined) {
      sets.push(`attempts = $${i++}`);
      values.push(patch.attempts);
    }
    if (patch.verified_at !== undefined) {
      sets.push(`verified_at = $${i++}`);
      values.push(patch.verified_at);
    }
    if (!sets.length) return this.getSessionById(sessionId);

    values.push(sessionId);
    const { rows } = await this.pg.query(
      `update whatsapp_bridge_sessions set ${sets.join(", ")}
       where id = $${i} returning ${SESSION_COLUMNS}`,
      values
    );
    return rows[0] ? mapSession(rows[0]) : null;
  }

  async listPendingSessionsByPhone(phoneE164: string): Promise<BridgeSessionRow[]> {
    const { rows } = await this.pg.query(
      `select ${SESSION_COLUMNS} from whatsapp_bridge_sessions
       where phone_e164 = $1 and status = 'pending'
       order by created_at desc`,
      [phoneE164]
    );
    return rows.map(mapSession);
  }

  async createEventIfAbsent(input: CreateBridgeEventInput): Promise<boolean> {
    const { rowCount } = await this.pg.query(
      `insert into whatsapp_bridge_events
         (session_id, project_key, event_type, payload, delivery_status,
          delivery_attempts, next_retry_at, callback_url)
       values ($1,$2,$3,$4,'pending',0,now(),$5)
       on conflict (session_id, event_type) do nothing`,
      [
        input.session.id,
        input.session.project_key,
        input.eventType,
        JSON.stringify(input.payload ?? {}),
        input.session.callback_url
      ]
    );
    return Boolean(rowCount && rowCount > 0);
  }

  async updateEvent(eventId: number, patch: BridgeEventPatch): Promise<BridgeEventRow | null> {
    const sets: string[] = [];
    const values: unknown[] = [];
    let i = 1;
    // processing_started_at no existe en el schema base: se omite a propósito.
    const allowed: Array<[keyof BridgeEventPatch, string]> = [
      ["delivery_status", "delivery_status"],
      ["delivery_attempts", "delivery_attempts"],
      ["next_retry_at", "next_retry_at"],
      ["delivered_at", "delivered_at"],
      ["last_error", "last_error"]
    ];
    for (const [key, column] of allowed) {
      if (patch[key] !== undefined) {
        sets.push(`${column} = $${i++}`);
        values.push(patch[key]);
      }
    }
    if (!sets.length) return null;

    values.push(eventId);
    const { rows } = await this.pg.query(
      `update whatsapp_bridge_events set ${sets.join(", ")}
       where id = $${i} returning ${EVENT_COLUMNS}`,
      values
    );
    return rows[0] ? mapEvent(rows[0]) : null;
  }

  async claimDueEvents(input: {
    projectKey?: string;
    limit: number;
    now: Date;
  }): Promise<BridgeEventRow[]> {
    const values: unknown[] = [input.now];
    let filter = "";
    if (input.projectKey) {
      values.push(input.projectKey);
      filter = ` and project_key = $${values.length}`;
    }
    values.push(input.limit);
    const { rows } = await this.pg.query(
      `select ${EVENT_COLUMNS} from whatsapp_bridge_events
       where delivery_status = 'pending' and next_retry_at <= $1${filter}
       order by next_retry_at asc, id asc
       limit $${values.length}`,
      values
    );
    return rows.map(mapEvent);
  }

  async getLatestEventBySession(sessionId: string): Promise<BridgeEventRow | null> {
    const { rows } = await this.pg.query(
      `select ${EVENT_COLUMNS} from whatsapp_bridge_events
       where session_id = $1 order by created_at desc limit 1`,
      [sessionId]
    );
    return rows[0] ? mapEvent(rows[0]) : null;
  }
}
