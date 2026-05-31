import type { AccountLink } from "./types.js";

/**
 * Persistencia de los vínculos teléfono↔cuenta y de los OTP de vínculo.
 * Igual que el store de conversación: Postgres si hay pool, memoria si no, para
 * que la falta de BD no tumbe el webhook.
 */

/** Mínimo de `pg.Pool` que usamos (facilita el mock en tests). */
export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}

export interface CreateOtpInput {
  phoneE164: string;
  serviceId: string;
  accountId: string;
  code: string;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  ttlSeconds: number;
}

export interface VerifyOtpInput {
  phoneE164: string;
  serviceId: string;
  code: string;
  maxAttempts: number;
}

export type VerifyOtpStatus = "verified" | "invalid" | "expired" | "none";

export interface VerifyOtpResult {
  status: VerifyOtpStatus;
  accountId?: string;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
}

/** Igual que VerifyOtpResult pero indica de qué servicio era el OTP. */
export interface VerifyAnyOtpResult extends VerifyOtpResult {
  serviceId?: string;
}

/** Intento de vínculo pendiente (espera el código 2FA o el OTP enviado). */
export interface PendingLink {
  id: string | number;
  serviceId: string;
  accountId: string;
  displayName?: string | null;
  metadata: Record<string, unknown>;
  via: "otp" | "totp";
  code: string;
  attempts: number;
  expired: boolean;
}

export interface CreatePendingLinkInput {
  phoneE164: string;
  serviceId: string;
  accountId: string;
  displayName?: string | null;
  metadata?: Record<string, unknown>;
  via: "otp" | "totp";
  code?: string;
  ttlSeconds: number;
}

/** Sesión 2FA del chat (autenticación fuerte con TTL deslizante). */
export interface AuthSession {
  phoneE164: string;
  serviceId: string;
  accountId: string;
  method: string;
  expiresAt: Date;
}

/** Sesión a servidor en background abierta desde WhatsApp (Fase 2). */
export interface ServerSession {
  phoneE164: string;
  serviceId: string;
  accountId: string;
  targetId: string;
  conversationId: string;
  lpSessionId?: string | null;
  status: "active" | "ended";
}

export interface LinkStore {
  /** Vínculo activo para (teléfono, servicio), o null. */
  getLink(phoneE164: string, serviceId: string): Promise<AccountLink | null>;
  /** Todos los vínculos activos del número. */
  listLinks(phoneE164: string): Promise<AccountLink[]>;
  /** Crea o actualiza (upsert) un vínculo y lo marca verificado/activo. */
  saveLink(link: Omit<AccountLink, "status"> & { status?: AccountLink["status"] }): Promise<void>;
  /** Marca un vínculo como revocado. */
  revokeLink(phoneE164: string, serviceId: string): Promise<void>;
  /** Crea un OTP de vínculo pendiente. */
  createOtp(input: CreateOtpInput): Promise<void>;
  /** Verifica el OTP más reciente para (teléfono, servicio). */
  verifyOtp(input: VerifyOtpInput): Promise<VerifyOtpResult>;
  /**
   * Verifica un OTP de vínculo pendiente para el teléfono SIN saber el servicio
   * (busca en todos los servicios). Para confirmar el vínculo de forma
   * determinista desde el webhook cuando llega un código suelto.
   */
  verifyOtpAnyService(input: {
    phoneE164: string;
    code: string;
    maxAttempts: number;
  }): Promise<VerifyAnyOtpResult>;
  /** Borra OTP vencidos. */
  pruneOtps(): Promise<void>;

  // ── Vínculo pendiente (flujo 2FA/TOTP) ───────────────────────────────────
  /** Crea un intento de vínculo pendiente. */
  createPendingLink(input: CreatePendingLinkInput): Promise<void>;
  /** Intento de vínculo pendiente más reciente (vivo) para el teléfono. */
  getActivePendingLink(phoneE164: string): Promise<PendingLink | null>;
  /** Marca el intento como verificado (consumido). */
  markPendingVerified(id: string | number): Promise<void>;
  /** Suma un intento fallido; expira si supera el máximo. Devuelve el estado. */
  bumpPendingAttempt(id: string | number, maxAttempts: number): Promise<"invalid" | "expired">;

  // ── Sesión 2FA del chat ──────────────────────────────────────────────────
  /** Sesión 2FA viva para el teléfono, o null. */
  getAuthSession(phoneE164: string): Promise<AuthSession | null>;
  /** Abre/renueva la sesión 2FA con un nuevo vencimiento. */
  openAuthSession(input: {
    phoneE164: string;
    serviceId: string;
    accountId: string;
    method: string;
    ttlSeconds: number;
  }): Promise<void>;
  /** Renueva el vencimiento (sliding) si hay sesión viva. */
  touchAuthSession(phoneE164: string, ttlSeconds: number): Promise<void>;
  /** Borra la sesión 2FA del teléfono. */
  deleteAuthSession(phoneE164: string): Promise<void>;
  /**
   * Purga sesiones 2FA inactivas (> ttl) y, para esos teléfonos, borra el
   * historial de conversación y cierra sesiones a servidor. Devuelve los
   * teléfonos purgados.
   */
  purgeInactive(ttlSeconds: number): Promise<string[]>;

  /** Sesión a servidor activa para (teléfono, servicio), o null. */
  getServerSession(phoneE164: string, serviceId: string): Promise<ServerSession | null>;
  /** Crea o reactiva (upsert) la sesión a servidor. */
  saveServerSession(session: ServerSession): Promise<void>;
  /** Marca como terminada la sesión a servidor activa. */
  endServerSession(phoneE164: string, serviceId: string): Promise<void>;
}
