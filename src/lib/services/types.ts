/**
 * Capa de servicios: abstracción genérica para vincular un número de WhatsApp
 * con la cuenta de un servicio externo (LP-LICENSE-SERVER, LUXIPANEL, LuxiChat,
 * y los que se enchufen después) y, ya vinculado, consultar perfil/cuenta y
 * operar la API de ese servicio desde el chat.
 *
 * Agregar un servicio nuevo = nuevo `ServiceConnector` registrado en
 * `registry.ts`. El runtime y las tools del agente no conocen los detalles de
 * cada servicio; hablan solo con esta interfaz.
 */

/** Resultado de buscar la cuenta de un servicio a partir de un teléfono. */
export interface LinkCandidate {
  accountId: string;
  displayName?: string;
  /** El teléfono ya está verificado por WhatsApp en la cuenta del servicio
   *  (OTP hecho en Ajustes). Prerrequisito para enlazar y operar servicios. */
  whatsappVerified?: boolean;
  metadata?: Record<string, unknown>;
}

/** Vínculo persistido teléfono↔cuenta de un servicio. */
export interface AccountLink {
  phoneE164: string;
  serviceId: string;
  accountId: string;
  displayName?: string | null;
  status: "active" | "revoked";
  metadata: Record<string, unknown>;
  verifiedAt?: Date | null;
}

/** Petición genérica a la API de un servicio (acotada por allowlist del connector). */
export interface ServiceApiRequest {
  action: string;
  params?: Record<string, unknown>;
}

export interface ServiceCapabilities {
  /** Soporta consulta de perfil/cuenta (Fase 1). */
  profile: boolean;
  /** Soporta conducir el asistente IA del servidor en background (Fase 2). */
  serverAssistant: boolean;
}

/**
 * Contrato de un servicio enchufable. Cada método debe degradar con gracia
 * (devolver `null` o lanzar un Error con mensaje claro) si el servicio no está
 * configurado, en vez de tumbar el webhook.
 */
export interface ServiceConnector {
  /** Clave estable del servicio (p.ej. "lp", "luxipanel", "luxichat"). */
  id: string;
  /** Nombre legible para el usuario. */
  name: string;
  capabilities(): ServiceCapabilities;
  /** Busca la cuenta cuyo teléfono registrado coincide con `e164`. */
  findAccountByPhone(e164: string): Promise<LinkCandidate | null>;
  /** Perfil/cuenta del servicio para un vínculo ya verificado. */
  getProfile(link: AccountLink): Promise<Record<string, unknown>>;
  /** Acceso genérico a la API del servicio (acotado por el connector). */
  callApi(link: AccountLink, req: ServiceApiRequest): Promise<unknown>;

  // ── 2FA obligatorio ────────────────────────────────────────────────────
  /**
   * ¿La cuenta tiene 2FA activo? El vínculo es OBLIGATORIO con 2FA: si el
   * servicio no implementa esto (undefined) no se puede vincular (sin 2FA
   * verificable no hay garantía de identidad). Devuelve null si el servicio no
   * soporta verificación 2FA por este canal.
   */
  is2faEnabled?(accountId: string): Promise<boolean>;
  /** Verifica un código 2FA (TOTP/recuperación) de la cuenta. */
  verify2fa?(accountId: string, code: string): Promise<boolean>;
}
