import type { AccountLink } from "./types.js";
import type {
  AuthSession,
  CreateOtpInput,
  CreatePendingLinkInput,
  LinkStore,
  PendingLink,
  PgLike,
  ServerSession,
  VerifyAnyOtpResult,
  VerifyOtpInput,
  VerifyOtpResult
} from "./store.js";

function toMetadata(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function rowToLink(row: any): AccountLink {
  return {
    phoneE164: String(row.phone_e164),
    serviceId: String(row.service_id),
    accountId: String(row.account_id),
    displayName: row.display_name ?? null,
    status: String(row.status) === "revoked" ? "revoked" : "active",
    metadata: toMetadata(row.metadata),
    verifiedAt: row.verified_at ? new Date(row.verified_at) : null
  };
}

/**
 * Persistencia en `whatsapp_account_links` + `whatsapp_link_otps` (ver
 * db/schema.sql). Sobrevive a reinicios.
 */
export class PostgresLinkStore implements LinkStore {
  constructor(private readonly pg: PgLike) {}

  async getLink(phoneE164: string, serviceId: string): Promise<AccountLink | null> {
    const { rows } = await this.pg.query(
      `select phone_e164, service_id, account_id, display_name, status, metadata, verified_at
         from whatsapp_account_links
        where phone_e164 = $1 and service_id = $2 and status = 'active'
        limit 1`,
      [phoneE164, serviceId]
    );
    return rows[0] ? rowToLink(rows[0]) : null;
  }

  async listLinks(phoneE164: string): Promise<AccountLink[]> {
    const { rows } = await this.pg.query(
      `select phone_e164, service_id, account_id, display_name, status, metadata, verified_at
         from whatsapp_account_links
        where phone_e164 = $1 and status = 'active'
        order by service_id asc`,
      [phoneE164]
    );
    return rows.map(rowToLink);
  }

  async saveLink(
    link: Omit<AccountLink, "status"> & { status?: AccountLink["status"] }
  ): Promise<void> {
    await this.pg.query(
      `insert into whatsapp_account_links
         (phone_e164, service_id, account_id, display_name, status, metadata, verified_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, now())
       on conflict (phone_e164, service_id) do update
         set account_id = excluded.account_id,
             display_name = excluded.display_name,
             status = excluded.status,
             metadata = excluded.metadata,
             verified_at = now()`,
      [
        link.phoneE164,
        link.serviceId,
        link.accountId,
        link.displayName ?? null,
        link.status ?? "active",
        JSON.stringify(link.metadata ?? {})
      ]
    );
  }

  async revokeLink(phoneE164: string, serviceId: string): Promise<void> {
    await this.pg.query(
      `update whatsapp_account_links set status = 'revoked'
        where phone_e164 = $1 and service_id = $2`,
      [phoneE164, serviceId]
    );
  }

  async createOtp(input: CreateOtpInput): Promise<void> {
    await this.pg.query(
      `insert into whatsapp_link_otps
         (phone_e164, service_id, account_id, code, display_name, metadata, expires_at)
       values ($1, $2, $3, $4, $5, $6::jsonb, now() + ($7 || ' seconds')::interval)`,
      [
        input.phoneE164,
        input.serviceId,
        input.accountId,
        input.code,
        input.displayName ?? null,
        JSON.stringify(input.metadata ?? {}),
        String(input.ttlSeconds)
      ]
    );
  }

  private async verifyRows(
    rows: any[],
    code: string,
    maxAttempts: number
  ): Promise<VerifyAnyOtpResult> {
    if (!rows.length) return { status: "none" };

    const match = rows.find((r) => String(r.code) === code) ?? null;
    if (match) {
      if (match.expired) {
        await this.pg.query(`update whatsapp_link_otps set expires_at = now() where id = $1`, [
          match.id
        ]);
        return { status: "expired" };
      }
      await this.pg.query(
        `update whatsapp_link_otps set verified_at = now() where id = $1 and verified_at is null`,
        [match.id]
      );
      return {
        status: "verified",
        serviceId: match.service_id ? String(match.service_id) : undefined,
        accountId: String(match.account_id),
        displayName: match.display_name ?? null,
        metadata: toMetadata(match.metadata)
      };
    }

    const latest = rows[0];
    if (latest.expired) {
      await this.pg.query(`update whatsapp_link_otps set expires_at = now() where id = $1`, [
        latest.id
      ]);
      return { status: "expired" };
    }
    const exhausted = Number(latest.attempts) + 1 >= maxAttempts;
    await this.pg.query(
      exhausted
        ? `update whatsapp_link_otps set attempts = attempts + 1, expires_at = now() where id = $1`
        : `update whatsapp_link_otps set attempts = attempts + 1 where id = $1`,
      [latest.id]
    );
    return { status: exhausted ? "expired" : "invalid" };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const { rows } = await this.pg.query(
      `select id, service_id, account_id, display_name, metadata, code,
              (expires_at <= now()) as expired, attempts
         from whatsapp_link_otps
        where phone_e164 = $1 and service_id = $2 and verified_at is null
        order by created_at desc, id desc`,
      [input.phoneE164, input.serviceId]
    );
    return this.verifyRows(rows, input.code, input.maxAttempts);
  }

  async verifyOtpAnyService(input: {
    phoneE164: string;
    code: string;
    maxAttempts: number;
  }): Promise<VerifyAnyOtpResult> {
    const { rows } = await this.pg.query(
      `select id, service_id, account_id, display_name, metadata, code,
              (expires_at <= now()) as expired, attempts
         from whatsapp_link_otps
        where phone_e164 = $1 and verified_at is null
        order by created_at desc, id desc`,
      [input.phoneE164]
    );
    return this.verifyRows(rows, input.code, input.maxAttempts);
  }

  async pruneOtps(): Promise<void> {
    await this.pg.query(
      `delete from whatsapp_link_otps where expires_at <= now() or verified_at is not null`
    );
  }

  async createPendingLink(input: CreatePendingLinkInput): Promise<void> {
    await this.pg.query(
      `insert into whatsapp_link_otps
         (phone_e164, service_id, account_id, code, via, display_name, metadata, expires_at)
       values ($1, $2, $3, $4, $5, $6, $7::jsonb, now() + ($8 || ' seconds')::interval)`,
      [
        input.phoneE164,
        input.serviceId,
        input.accountId,
        input.code ?? "",
        input.via,
        input.displayName ?? null,
        JSON.stringify(input.metadata ?? {}),
        String(input.ttlSeconds)
      ]
    );
  }

  async getActivePendingLink(phoneE164: string): Promise<PendingLink | null> {
    const { rows } = await this.pg.query(
      `select id, service_id, account_id, display_name, metadata, via, code, attempts,
              (expires_at <= now()) as expired
         from whatsapp_link_otps
        where phone_e164 = $1 and verified_at is null
        order by created_at desc, id desc
        limit 1`,
      [phoneE164]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      id: r.id,
      serviceId: String(r.service_id),
      accountId: String(r.account_id),
      displayName: r.display_name ?? null,
      metadata: toMetadata(r.metadata),
      via: String(r.via) === "totp" ? "totp" : "otp",
      code: String(r.code ?? ""),
      attempts: Number(r.attempts),
      expired: Boolean(r.expired)
    };
  }

  async markPendingVerified(id: string | number): Promise<void> {
    await this.pg.query(
      `update whatsapp_link_otps set verified_at = now() where id = $1 and verified_at is null`,
      [id]
    );
  }

  async bumpPendingAttempt(
    id: string | number,
    maxAttempts: number
  ): Promise<"invalid" | "expired"> {
    const { rows } = await this.pg.query(
      `update whatsapp_link_otps set attempts = attempts + 1 where id = $1 returning attempts`,
      [id]
    );
    const attempts = rows[0] ? Number(rows[0].attempts) : maxAttempts;
    if (attempts >= maxAttempts) {
      await this.pg.query(`update whatsapp_link_otps set expires_at = now() where id = $1`, [id]);
      return "expired";
    }
    return "invalid";
  }

  async getAuthSession(phoneE164: string): Promise<AuthSession | null> {
    const { rows } = await this.pg.query(
      `select phone_e164, service_id, account_id, method, expires_at
         from whatsapp_auth_sessions
        where phone_e164 = $1 and expires_at > now()`,
      [phoneE164]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      phoneE164: String(r.phone_e164),
      serviceId: String(r.service_id),
      accountId: String(r.account_id),
      method: String(r.method),
      expiresAt: new Date(r.expires_at)
    };
  }

  async openAuthSession(input: {
    phoneE164: string;
    serviceId: string;
    accountId: string;
    method: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.pg.query(
      `insert into whatsapp_auth_sessions
         (phone_e164, service_id, account_id, method, authenticated_at, last_activity_at, expires_at)
       values ($1, $2, $3, $4, now(), now(), now() + ($5 || ' seconds')::interval)
       on conflict (phone_e164) do update
         set service_id = excluded.service_id,
             account_id = excluded.account_id,
             method = excluded.method,
             authenticated_at = now(),
             last_activity_at = now(),
             expires_at = excluded.expires_at`,
      [input.phoneE164, input.serviceId, input.accountId, input.method, String(input.ttlSeconds)]
    );
  }

  async touchAuthSession(phoneE164: string, ttlSeconds: number): Promise<void> {
    await this.pg.query(
      `update whatsapp_auth_sessions
          set last_activity_at = now(), expires_at = now() + ($2 || ' seconds')::interval
        where phone_e164 = $1 and expires_at > now()`,
      [phoneE164, String(ttlSeconds)]
    );
  }

  async deleteAuthSession(phoneE164: string): Promise<void> {
    await this.pg.query(`delete from whatsapp_auth_sessions where phone_e164 = $1`, [phoneE164]);
  }

  async purgeInactive(_ttlSeconds: number): Promise<string[]> {
    // expires_at = última actividad + ttl (deslizante); vencida = inactiva.
    const { rows } = await this.pg.query(
      `delete from whatsapp_auth_sessions where expires_at <= now() returning phone_e164`
    );
    const phones = rows.map((r) => String(r.phone_e164));
    if (phones.length) {
      await this.pg.query(`delete from whatsapp_agent_messages where phone_e164 = any($1::text[])`, [
        phones
      ]);
      await this.pg.query(
        `update whatsapp_server_sessions set status = 'ended', ended_at = now()
          where phone_e164 = any($1::text[]) and status = 'active'`,
        [phones]
      );
    }
    return phones;
  }

  async getServerSession(phoneE164: string, serviceId: string): Promise<ServerSession | null> {
    const { rows } = await this.pg.query(
      `select phone_e164, service_id, account_id, target_id, conversation_id, lp_session_id, status
         from whatsapp_server_sessions
        where phone_e164 = $1 and service_id = $2 and status = 'active'
        order by id desc
        limit 1`,
      [phoneE164, serviceId]
    );
    const r = rows[0];
    if (!r) return null;
    return {
      phoneE164: String(r.phone_e164),
      serviceId: String(r.service_id),
      accountId: String(r.account_id),
      targetId: String(r.target_id),
      conversationId: String(r.conversation_id),
      lpSessionId: r.lp_session_id ?? null,
      status: "active"
    };
  }

  async saveServerSession(session: ServerSession): Promise<void> {
    // Cierra cualquier sesión activa previa de ese (teléfono, servicio) y crea la nueva.
    await this.pg.query(
      `update whatsapp_server_sessions set status = 'ended', ended_at = now()
        where phone_e164 = $1 and service_id = $2 and status = 'active'`,
      [session.phoneE164, session.serviceId]
    );
    await this.pg.query(
      `insert into whatsapp_server_sessions
         (phone_e164, service_id, account_id, lp_session_id, target_id, conversation_id, status, last_activity_at)
       values ($1, $2, $3, $4, $5, $6, 'active', now())`,
      [
        session.phoneE164,
        session.serviceId,
        session.accountId,
        session.lpSessionId ?? null,
        session.targetId,
        session.conversationId
      ]
    );
  }

  async endServerSession(phoneE164: string, serviceId: string): Promise<void> {
    await this.pg.query(
      `update whatsapp_server_sessions set status = 'ended', ended_at = now()
        where phone_e164 = $1 and service_id = $2 and status = 'active'`,
      [phoneE164, serviceId]
    );
  }
}
