import type { PoolClient } from "pg";
import { getPool } from "../pool.js";
import type { BridgeSessionRow, BridgeEventRow } from "../../../domain/bridge/types.js";

export type BridgeEventForDispatch = BridgeEventRow & {
  session_callback_url: string | null;
};

export type BridgeEventStatusRow = {
  id: number;
  event_type: string;
  delivery_status: BridgeEventRow["delivery_status"];
  delivery_attempts: number;
  next_retry_at: Date;
  delivered_at: Date | null;
  last_error: string | null;
  created_at: Date;
};

function mapSessionRow(row: any): BridgeSessionRow {
  return {
    ...row,
    expires_at: new Date(row.expires_at),
    verified_at: row.verified_at ? new Date(row.verified_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    metadata: row.metadata ?? null
  };
}

function mapEventRow(row: any): BridgeEventRow {
  return {
    ...row,
    next_retry_at: new Date(row.next_retry_at),
    processing_started_at: row.processing_started_at ? new Date(row.processing_started_at) : null,
    delivered_at: row.delivered_at ? new Date(row.delivered_at) : null,
    created_at: new Date(row.created_at),
    updated_at: new Date(row.updated_at),
    payload: row.payload ?? {}
  };
}

export async function insertBridgeSession(
  session: Omit<BridgeSessionRow, "created_at" | "updated_at">
): Promise<BridgeSessionRow> {
  const pool = getPool();
  const { rows } = await pool.query(
    `INSERT INTO whatsapp_bridge_sessions
     (id, project_key, flow, user_ref, correlation_id, phone_e164, code, otp_ref,
      status, attempts, expires_at, verified_at, callback_url, metadata)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
     RETURNING *`,
    [
      session.id, session.project_key, session.flow, session.user_ref,
      session.correlation_id, session.phone_e164, session.code, session.otp_ref,
      session.status, session.attempts, session.expires_at, session.verified_at,
      session.callback_url, session.metadata ? JSON.stringify(session.metadata) : null
    ]
  );
  return mapSessionRow(rows[0]);
}

export async function findBridgeSessionById(
  projectKey: string,
  sessionId: string
): Promise<BridgeSessionRow | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT * FROM whatsapp_bridge_sessions WHERE id = $1 AND project_key = $2 LIMIT 1`,
    [sessionId, projectKey]
  );
  return rows[0] ? mapSessionRow(rows[0]) : null;
}

export async function updateBridgeSession(
  sessionId: string,
  patch: {
    status?: BridgeSessionRow["status"];
    attempts?: number;
    verified_at?: Date | null;
  }
): Promise<BridgeSessionRow> {
  const pool = getPool();
  const { rows } = await pool.query(
    `UPDATE whatsapp_bridge_sessions
     SET status      = COALESCE($1, status),
         attempts    = COALESCE($2, attempts),
         verified_at = CASE WHEN $3::bool THEN $4 ELSE verified_at END,
         updated_at  = now()
     WHERE id = $5
     RETURNING *`,
    [
      patch.status ?? null,
      patch.attempts ?? null,
      "verified_at" in patch,
      patch.verified_at ?? null,
      sessionId
    ]
  );
  return mapSessionRow(rows[0]);
}

export async function findAndLockPendingSessionsByPhone(
  client: PoolClient,
  phoneE164: string
): Promise<BridgeSessionRow[]> {
  const { rows } = await client.query(
    `SELECT * FROM whatsapp_bridge_sessions
     WHERE phone_e164 = $1 AND status = 'pending'
     ORDER BY created_at DESC
     FOR UPDATE SKIP LOCKED`,
    [phoneE164]
  );
  return rows.map(mapSessionRow);
}

export async function updateBridgeSessionTx(
  client: PoolClient,
  sessionId: string,
  patch: {
    status?: BridgeSessionRow["status"];
    attempts?: number;
    verified_at?: Date | null;
  }
): Promise<BridgeSessionRow> {
  const { rows } = await client.query(
    `UPDATE whatsapp_bridge_sessions
     SET status      = COALESCE($1, status),
         attempts    = COALESCE($2, attempts),
         verified_at = CASE WHEN $3::bool THEN $4 ELSE verified_at END,
         updated_at  = now()
     WHERE id = $5
     RETURNING *`,
    [
      patch.status ?? null,
      patch.attempts ?? null,
      "verified_at" in patch,
      patch.verified_at ?? null,
      sessionId
    ]
  );
  return mapSessionRow(rows[0]);
}

export async function insertBridgeEventIfAbsent(event: {
  session_id: string;
  project_key: string;
  event_type: string;
  payload: Record<string, unknown>;
  next_retry_at: Date;
}): Promise<boolean> {
  const pool = getPool();
  const { rowCount } = await pool.query(
    `INSERT INTO whatsapp_bridge_events
     (session_id, project_key, event_type, payload, delivery_status, delivery_attempts,
      next_retry_at, processing_started_at, delivered_at, last_error)
     VALUES ($1,$2,$3,$4,'pending',0,$5,null,null,null)
     ON CONFLICT (session_id, event_type) DO NOTHING`,
    [
      event.session_id, event.project_key, event.event_type,
      JSON.stringify(event.payload), event.next_retry_at
    ]
  );
  return (rowCount ?? 0) > 0;
}

export async function claimDueBridgeEvents(
  projectKey: string | undefined,
  limit: number
): Promise<BridgeEventForDispatch[]> {
  const pool = getPool();
  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const { rows: idRows } = await client.query(
      `SELECT e.id
       FROM whatsapp_bridge_events e
       WHERE e.delivery_status = 'pending'
         AND e.next_retry_at <= now()
         AND ($1::text IS NULL OR e.project_key = $1)
       ORDER BY e.next_retry_at, e.id
       LIMIT $2
       FOR UPDATE SKIP LOCKED`,
      [projectKey ?? null, limit]
    );

    if (idRows.length === 0) {
      await client.query("COMMIT");
      return [];
    }

    const ids = idRows.map((r: any) => r.id);
    const placeholders = ids.map((_: any, i: number) => `$${i + 1}`).join(",");

    await client.query(
      `UPDATE whatsapp_bridge_events
       SET delivery_status = 'processing',
           processing_started_at = now(),
           updated_at = now()
       WHERE id IN (${placeholders})`,
      ids
    );

    const { rows } = await client.query(
      `SELECT e.*, s.callback_url AS session_callback_url
       FROM whatsapp_bridge_events e
       JOIN whatsapp_bridge_sessions s ON s.id = e.session_id
       WHERE e.id IN (${placeholders})`,
      ids
    );

    await client.query("COMMIT");
    return rows.map((row: any) => ({
      ...mapEventRow(row),
      session_callback_url: row.session_callback_url ?? null
    }));
  } catch (err) {
    await client.query("ROLLBACK");
    throw err;
  } finally {
    client.release();
  }
}

export async function markEventDelivered(eventId: number): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE whatsapp_bridge_events
     SET delivery_status = 'delivered',
         delivered_at = now(),
         processing_started_at = null,
         updated_at = now()
     WHERE id = $1`,
    [eventId]
  );
}

export async function markEventFailed(
  eventId: number,
  error: string,
  nextRetryAt: Date | null,
  newStatus: "pending" | "failed"
): Promise<void> {
  const pool = getPool();
  await pool.query(
    `UPDATE whatsapp_bridge_events
     SET delivery_status = $1,
         delivery_attempts = delivery_attempts + 1,
         last_error = $2,
         next_retry_at = COALESCE($3, next_retry_at),
         processing_started_at = null,
         updated_at = now()
     WHERE id = $4`,
    [newStatus, error.slice(0, 1000), nextRetryAt, eventId]
  );
}

export async function findLatestEventBySession(
  sessionId: string
): Promise<BridgeEventStatusRow | null> {
  const pool = getPool();
  const { rows } = await pool.query(
    `SELECT id, event_type, delivery_status, delivery_attempts,
            next_retry_at, delivered_at, last_error, created_at
     FROM whatsapp_bridge_events
     WHERE session_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [sessionId]
  );
  if (!rows[0]) return null;
  const r = rows[0];
  return {
    id: r.id,
    event_type: r.event_type,
    delivery_status: r.delivery_status,
    delivery_attempts: r.delivery_attempts,
    next_retry_at: new Date(r.next_retry_at),
    delivered_at: r.delivered_at ? new Date(r.delivered_at) : null,
    last_error: r.last_error,
    created_at: new Date(r.created_at)
  };
}
