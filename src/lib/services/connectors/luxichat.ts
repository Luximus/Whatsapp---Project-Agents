import { env } from "../../../env.js";
import type { AccountLink, LinkCandidate, ServiceApiRequest, ServiceConnector } from "../types.js";

/**
 * Connector de LuxiChat. Servicio independiente; se degrada si no hay
 * `LUXICHAT_API_BASE_URL`/`LUXICHAT_S2S_TOKEN` (devuelve null / lanza error
 * claro) en vez de tumbar el webhook. El contrato HTTP exacto puede afinarse;
 * aquí se asume un endpoint de búsqueda por teléfono y uno de perfil.
 */
function configured(): boolean {
  return Boolean(env.luxichatApiBaseUrl && env.luxichatS2sToken);
}

async function chatRequest<T>(
  pathname: string,
  init: { method: "GET" | "POST"; body?: unknown }
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), env.lpS2sTimeoutMs);
  try {
    const res = await fetch(`${env.luxichatApiBaseUrl}${pathname}`, {
      method: init.method,
      headers: {
        authorization: `Bearer ${env.luxichatS2sToken}`,
        "content-type": "application/json",
        accept: "application/json"
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: controller.signal
    });
    if (res.status === 404) return { found: false } as unknown as T;
    if (!res.ok) throw new Error(`luxichat_http_${res.status}`);
    return (await res.json()) as T;
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("luxichat_timeout");
    throw err instanceof Error ? err : new Error("luxichat_request_failed");
  } finally {
    clearTimeout(timer);
  }
}

export const luxichatConnector: ServiceConnector = {
  id: "luxichat",
  name: "LuxiChat",

  capabilities() {
    return { profile: configured(), serverAssistant: false };
  },

  async findAccountByPhone(e164: string): Promise<LinkCandidate | null> {
    if (!configured()) return null;
    const res = await chatRequest<{ found: boolean; userId?: string; displayName?: string }>(
      "/api/identity/by-phone",
      { method: "POST", body: { e164 } }
    );
    if (!res.found || !res.userId) return null;
    return { accountId: res.userId, displayName: res.displayName };
  },

  async getProfile(link: AccountLink): Promise<Record<string, unknown>> {
    if (!configured()) throw new Error("luxichat_no_configurado");
    return chatRequest<Record<string, unknown>>(
      `/api/profile?userId=${encodeURIComponent(link.accountId)}`,
      { method: "GET" }
    );
  },

  async callApi(link: AccountLink, req: ServiceApiRequest): Promise<unknown> {
    if (!configured()) throw new Error("luxichat_no_configurado");
    if (req.action === "profile") return this.getProfile(link);
    throw new Error(`accion_no_soportada:${req.action}`);
  }
};
