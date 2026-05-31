import type { AccountLink } from "./types.js";
import type {
  AuthSession,
  CreateOtpInput,
  CreatePendingLinkInput,
  LinkStore,
  PendingLink,
  ServerSession,
  VerifyAnyOtpResult,
  VerifyOtpInput,
  VerifyOtpResult
} from "./store.js";

interface OtpRow {
  id: number;
  phoneE164: string;
  serviceId: string;
  accountId: string;
  code: string;
  via: "otp" | "totp";
  displayName?: string | null;
  metadata: Record<string, unknown>;
  expiresAt: number;
  verifiedAt: number | null;
  attempts: number;
  createdAt: number;
}

/** Store en memoria de proceso (fallback sin BD; no sobrevive a reinicios). */
export class MemoryLinkStore implements LinkStore {
  private readonly links = new Map<string, AccountLink>();
  private readonly serverSessions = new Map<string, ServerSession>();
  private readonly authSessions = new Map<string, AuthSession>();
  private otps: OtpRow[] = [];
  private seq = 0;

  private key(phoneE164: string, serviceId: string) {
    return `${phoneE164}::${serviceId}`;
  }

  async getLink(phoneE164: string, serviceId: string): Promise<AccountLink | null> {
    const link = this.links.get(this.key(phoneE164, serviceId));
    return link && link.status === "active" ? link : null;
  }

  async listLinks(phoneE164: string): Promise<AccountLink[]> {
    return [...this.links.values()].filter(
      (l) => l.phoneE164 === phoneE164 && l.status === "active"
    );
  }

  async saveLink(
    link: Omit<AccountLink, "status"> & { status?: AccountLink["status"] }
  ): Promise<void> {
    this.links.set(this.key(link.phoneE164, link.serviceId), {
      ...link,
      status: link.status ?? "active",
      metadata: link.metadata ?? {},
      verifiedAt: link.verifiedAt ?? new Date()
    });
  }

  async revokeLink(phoneE164: string, serviceId: string): Promise<void> {
    const existing = this.links.get(this.key(phoneE164, serviceId));
    if (existing) existing.status = "revoked";
  }

  async createOtp(input: CreateOtpInput): Promise<void> {
    this.otps.push({
      id: ++this.seq,
      phoneE164: input.phoneE164,
      serviceId: input.serviceId,
      accountId: input.accountId,
      code: input.code,
      via: "otp",
      displayName: input.displayName ?? null,
      metadata: input.metadata ?? {},
      expiresAt: Date.now() + input.ttlSeconds * 1000,
      verifiedAt: null,
      attempts: 0,
      createdAt: Date.now()
    });
  }

  async createPendingLink(input: CreatePendingLinkInput): Promise<void> {
    this.otps.push({
      id: ++this.seq,
      phoneE164: input.phoneE164,
      serviceId: input.serviceId,
      accountId: input.accountId,
      code: input.code ?? "",
      via: input.via,
      displayName: input.displayName ?? null,
      metadata: input.metadata ?? {},
      expiresAt: Date.now() + input.ttlSeconds * 1000,
      verifiedAt: null,
      attempts: 0,
      createdAt: Date.now()
    });
  }

  async getActivePendingLink(phoneE164: string): Promise<PendingLink | null> {
    const pending = this.otps
      .filter((o) => o.phoneE164 === phoneE164 && !o.verifiedAt)
      .sort((a, b) => b.createdAt - a.createdAt);
    const row = pending[0];
    if (!row) return null;
    return {
      id: row.id,
      serviceId: row.serviceId,
      accountId: row.accountId,
      displayName: row.displayName,
      metadata: row.metadata,
      via: row.via,
      code: row.code,
      attempts: row.attempts,
      expired: row.expiresAt <= Date.now()
    };
  }

  async markPendingVerified(id: string | number): Promise<void> {
    const row = this.otps.find((o) => o.id === id);
    if (row) row.verifiedAt = Date.now();
  }

  async bumpPendingAttempt(id: string | number, maxAttempts: number): Promise<"invalid" | "expired"> {
    const row = this.otps.find((o) => o.id === id);
    if (!row) return "expired";
    row.attempts += 1;
    if (row.attempts >= maxAttempts) {
      row.expiresAt = Date.now();
      return "expired";
    }
    return "invalid";
  }

  async getAuthSession(phoneE164: string): Promise<AuthSession | null> {
    const s = this.authSessions.get(phoneE164);
    if (!s) return null;
    return s.expiresAt.getTime() > Date.now() ? s : null;
  }

  async openAuthSession(input: {
    phoneE164: string;
    serviceId: string;
    accountId: string;
    method: string;
    ttlSeconds: number;
  }): Promise<void> {
    this.authSessions.set(input.phoneE164, {
      phoneE164: input.phoneE164,
      serviceId: input.serviceId,
      accountId: input.accountId,
      method: input.method,
      expiresAt: new Date(Date.now() + input.ttlSeconds * 1000)
    });
  }

  async touchAuthSession(phoneE164: string, ttlSeconds: number): Promise<void> {
    const s = this.authSessions.get(phoneE164);
    if (s && s.expiresAt.getTime() > Date.now()) {
      s.expiresAt = new Date(Date.now() + ttlSeconds * 1000);
    }
  }

  async deleteAuthSession(phoneE164: string): Promise<void> {
    this.authSessions.delete(phoneE164);
  }

  async purgeInactive(_ttlSeconds: number): Promise<string[]> {
    // expiresAt = última actividad + ttl (deslizante); vencida = inactiva.
    const now = Date.now();
    const purged: string[] = [];
    for (const [phone, s] of this.authSessions) {
      if (s.expiresAt.getTime() <= now) {
        this.authSessions.delete(phone);
        purged.push(phone);
      }
    }
    for (const phone of purged) {
      for (const [, sess] of this.serverSessions) {
        if (sess.phoneE164 === phone) sess.status = "ended";
      }
    }
    return purged;
  }

  private verifyPending(
    pending: OtpRow[],
    code: string,
    maxAttempts: number
  ): VerifyAnyOtpResult {
    if (!pending.length) return { status: "none" };
    const now = Date.now();
    const match = pending.find((o) => o.code === code) ?? null;
    if (match) {
      if (match.expiresAt <= now) {
        match.expiresAt = now;
        return { status: "expired" };
      }
      match.verifiedAt = now;
      return {
        status: "verified",
        serviceId: match.serviceId,
        accountId: match.accountId,
        displayName: match.displayName,
        metadata: match.metadata
      };
    }
    const latest = pending[0];
    if (latest.expiresAt <= now) {
      latest.expiresAt = now;
      return { status: "expired" };
    }
    latest.attempts += 1;
    if (latest.attempts >= maxAttempts) {
      latest.expiresAt = now;
      return { status: "expired" };
    }
    return { status: "invalid" };
  }

  async verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult> {
    const pending = this.otps
      .filter(
        (o) => o.phoneE164 === input.phoneE164 && o.serviceId === input.serviceId && !o.verifiedAt
      )
      .sort((a, b) => b.createdAt - a.createdAt);
    return this.verifyPending(pending, input.code, input.maxAttempts);
  }

  async verifyOtpAnyService(input: {
    phoneE164: string;
    code: string;
    maxAttempts: number;
  }): Promise<VerifyAnyOtpResult> {
    const pending = this.otps
      .filter((o) => o.phoneE164 === input.phoneE164 && !o.verifiedAt)
      .sort((a, b) => b.createdAt - a.createdAt);
    return this.verifyPending(pending, input.code, input.maxAttempts);
  }

  async pruneOtps(): Promise<void> {
    const now = Date.now();
    this.otps = this.otps.filter((o) => o.expiresAt > now && !o.verifiedAt);
  }

  async getServerSession(phoneE164: string, serviceId: string): Promise<ServerSession | null> {
    const s = this.serverSessions.get(this.key(phoneE164, serviceId));
    return s && s.status === "active" ? s : null;
  }

  async saveServerSession(session: ServerSession): Promise<void> {
    this.serverSessions.set(this.key(session.phoneE164, session.serviceId), { ...session });
  }

  async endServerSession(phoneE164: string, serviceId: string): Promise<void> {
    const s = this.serverSessions.get(this.key(phoneE164, serviceId));
    if (s) s.status = "ended";
  }
}
