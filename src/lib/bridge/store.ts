/**
 * Contrato de almacenamiento del Bridge OTP.
 *
 * `bridge.ts` (lógica de negocio: validación de códigos, firma de callbacks,
 * reintentos) depende SOLO de esta interfaz. Hay dos implementaciones:
 *   - MemoryBridgeStore   (default; comportamiento histórico, sin persistencia)
 *   - PostgresBridgeStore  (persiste en whatsapp_bridge_sessions/_events)
 *
 * La selección se hace por env `BRIDGE_STORE` (ver factory.ts). El default es
 * `memory` para NO cambiar el runtime de producción hasta activarlo de forma
 * explícita y verificada.
 */

export const BRIDGE_FLOWS = ["verification", "login", "register", "recovery"] as const;
export type BridgeFlow = (typeof BRIDGE_FLOWS)[number];

export type BridgeSessionStatus = "pending" | "verified" | "expired" | "cancelled";
export type BridgeEventStatus = "pending" | "processing" | "delivered" | "failed";

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

export type BridgeEventRow = {
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

export type CreateBridgeSessionInput = {
  id: string;
  projectKey: string;
  flow: BridgeFlow;
  userRef: string | null;
  correlationId: string | null;
  phoneE164: string;
  code: string;
  otpRef: string;
  expiresAt: Date;
  callbackUrl: string | null;
  metadata: Record<string, unknown> | null;
};

export type CreateBridgeEventInput = {
  session: BridgeSessionRow;
  eventType: string;
  payload: Record<string, unknown>;
};

/**
 * Mutaciones que el negocio aplica a una sesión. El store traduce esto a la
 * persistencia (UPDATE en SQL, mutación en memoria). Solo campos cambiables.
 */
export type BridgeSessionPatch = Partial<
  Pick<BridgeSessionRow, "status" | "attempts" | "verified_at">
>;

/** Mutaciones aplicables a un evento durante el dispatch. */
export type BridgeEventPatch = Partial<
  Pick<
    BridgeEventRow,
    | "delivery_status"
    | "delivery_attempts"
    | "next_retry_at"
    | "processing_started_at"
    | "delivered_at"
    | "last_error"
  >
>;

export interface BridgeStore {
  /** Limpia sesiones/eventos vencidos según política de retención. */
  prune(): Promise<void>;

  createSession(input: CreateBridgeSessionInput): Promise<BridgeSessionRow>;
  getSessionById(sessionId: string): Promise<BridgeSessionRow | null>;
  updateSession(sessionId: string, patch: BridgeSessionPatch): Promise<BridgeSessionRow | null>;
  /** Sesiones `pending` del teléfono, más recientes primero. */
  listPendingSessionsByPhone(phoneE164: string): Promise<BridgeSessionRow[]>;

  /**
   * Inserta un evento si no existe ya uno con (session_id, event_type).
   * Devuelve `false` si era duplicado (idempotencia de encolado).
   */
  createEventIfAbsent(input: CreateBridgeEventInput): Promise<boolean>;
  updateEvent(eventId: number, patch: BridgeEventPatch): Promise<BridgeEventRow | null>;
  /** Eventos `pending` con `next_retry_at <= now`, ordenados para dispatch. */
  claimDueEvents(input: { projectKey?: string; limit: number; now: Date }): Promise<BridgeEventRow[]>;
  /** Último evento de una sesión (para reportar estado del callback). */
  getLatestEventBySession(sessionId: string): Promise<BridgeEventRow | null>;
}
