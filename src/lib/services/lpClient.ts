import { env } from "../../env.js";

/**
 * Cliente HTTP server-to-server hacia LP-LICENSE-SERVER (la autoridad). Usa el
 * secreto compartido `LP_S2S_TOKEN`. Todos los endpoints viven bajo
 * `/panel-api/identity/*` y están protegidos en LP por `requireWhatsappKey`.
 *
 * No lanza secretos en logs ni en mensajes; ante fallo devuelve un Error con un
 * código corto para que el connector degrade con gracia.
 */

export interface LpAccountLookup {
  found: boolean;
  customerId?: string;
  displayName?: string;
  maskedEmail?: string;
  hasPanels?: boolean;
}

export interface LpPanelSummary {
  id: string;
  name: string;
  status: string;
  billingState?: string;
  subdomain?: string | null;
  customDomain?: string | null;
  serverIp?: string | null;
  serverSlots?: number;
}

export interface LpUsage {
  mb: number;
  gb: number;
  bytes: number;
  periodStart: string;
}

/**
 * Normaliza el consumo del mes para mostrarlo al cliente. LP agrega una columna
 * entera `mb` redondeada POR BUCKET: para tráfico sub-MB cada bucket guarda 0, y
 * la suma da 0 aunque haya MB reales. Por eso derivamos MB/GB de los `bytes`
 * reales (rx+tx, la fuente de verdad) y solo caemos a la columna `mb` si no hay
 * bytes. Devuelve también `bytes` para trazabilidad.
 */
export function monthlyUsage(usage?: LpUsage): { mb: number; gb: number; bytes: number; desde?: string } {
  const bytes = Number(usage?.bytes ?? 0);
  let mb = Math.round((bytes / 1_048_576) * 1000) / 1000;
  if (mb === 0 && Number(usage?.mb ?? 0) > 0) mb = Number(usage?.mb ?? 0);
  const gb = Math.round((mb / 1024) * 1000) / 1000;
  return { mb, gb, bytes, desde: usage?.periodStart };
}

export interface LpAccountSummary {
  customerId: string;
  name?: string;
  email?: string;
  phone?: string;
  freeBalance: number;
  paidBalance: number;
  usageThisMonth?: LpUsage;
  panels: LpPanelSummary[];
}

export interface LpIssuedSession {
  sessionId: string;
  sessionToken: string;
  redirectUrl: string;
  expiresAt: string;
}

export interface LpServer {
  id: string;
  name: string;
  host: string;
  port?: number;
  linuxUser: string;
  enabled?: boolean;
  status: string | null;
  panel?: { id: string; name: string };
}

function ensureConfigured() {
  if (!env.lpApiBaseUrl || !env.lpS2sToken) {
    throw new Error("lp_s2s_not_configured");
  }
}

async function lpRequest<T>(
  pathname: string,
  init: { method: "GET" | "POST"; body?: unknown } = { method: "GET" }
): Promise<T> {
  ensureConfigured();
  const url = `${env.lpApiBaseUrl}${pathname}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.lpS2sTimeoutMs);
  try {
    const res = await fetch(url, {
      method: init.method,
      headers: {
        authorization: `Bearer ${env.lpS2sToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });
    if (res.status === 404) {
      // Cuenta no encontrada: lo tratamos como "sin match", no como error duro.
      return { found: false } as unknown as T;
    }
    if (!res.ok) {
      throw new Error(`lp_http_${res.status}`);
    }
    const json = (await res.json()) as { ok?: boolean; data?: T } | T;
    if (json && typeof json === "object" && "data" in (json as Record<string, unknown>)) {
      return (json as { data: T }).data;
    }
    return json as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error("lp_timeout");
    }
    throw err instanceof Error ? err : new Error("lp_request_failed");
  } finally {
    clearTimeout(timer);
  }
}

export const lpClient = {
  /** Busca un cliente LP cuyo teléfono registrado coincide con `e164`. */
  lookupByPhone(e164: string): Promise<LpAccountLookup> {
    return lpRequest<LpAccountLookup>("/panel-api/identity/lookup-by-phone", {
      method: "POST",
      body: { e164 }
    });
  },

  /** Resumen de cuenta (saldo, paneles) de un cliente verificado. */
  accountSummary(customerId: string): Promise<LpAccountSummary> {
    return lpRequest<LpAccountSummary>(
      `/panel-api/identity/account-summary?customerId=${encodeURIComponent(customerId)}`,
      { method: "GET" }
    );
  },

  /** ¿La cuenta tiene 2FA (TOTP) activo? */
  twoFaStatus(customerId: string): Promise<{
    enabled: boolean;
    configured: boolean;
    hasRecoveryCodes: boolean;
  }> {
    return lpRequest(
      `/panel-api/identity/2fa-status?customerId=${encodeURIComponent(customerId)}`,
      { method: "GET" }
    );
  },

  /** Verifica un código 2FA (TOTP o de recuperación) del cliente. */
  twoFaVerify(customerId: string, code: string): Promise<{ verified: boolean; method?: string }> {
    return lpRequest("/panel-api/identity/2fa-verify", {
      method: "POST",
      body: { customerId, code }
    });
  },

  /** Servidores (accesos SSH) registrados del cliente. */
  async listServers(customerId: string): Promise<LpServer[]> {
    const data = await lpRequest<{ servers: LpServer[] }>(
      `/panel-api/identity/servers?customerId=${encodeURIComponent(customerId)}`,
      { method: "GET" }
    );
    return data.servers ?? [];
  },

  /** Activa/desactiva (soft-disable) un acceso SSH del cliente. */
  setSshEnabled(customerId: string, targetId: string, enabled: boolean): Promise<{
    id: string;
    name: string;
    enabled: boolean;
  }> {
    return lpRequest("/panel-api/identity/ssh/set-enabled", {
      method: "POST",
      body: { customerId, targetId, enabled }
    });
  },

  /**
   * Emite una sesión SSO para un cliente ya verificado por whatsapp (Fase 2).
   * LP firma el token (RS256); whatsapp nunca firma sesiones de panel.
   */
  issueSessionForLinked(input: {
    customerId: string;
    targetId: string;
    source?: string;
  }): Promise<LpIssuedSession> {
    return lpRequest<LpIssuedSession>("/panel-api/identity/issue-session-for-linked", {
      method: "POST",
      body: { ...input, source: input.source ?? "whatsapp_agent" }
    });
  }
};
