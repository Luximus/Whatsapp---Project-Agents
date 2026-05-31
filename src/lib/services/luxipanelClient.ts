import { env } from "../../env.js";

/**
 * Cliente headless del backend de LUXIPANEL para conducir el módulo asistente
 * desde WhatsApp. Flujo (ver receta en el plan):
 *   1. canjear el token SSO de LP en `/api/sso/callback` → sesión LUXIPANEL
 *      (JWT en cookie `lxp_session`); lo usamos como `Authorization: Bearer`.
 *   2. encolar mensajes en `/api/ai/agent/enqueue` (cola server-side; el run
 *      sobrevive a desconexiones).
 *   3. consultar `/api/ai/agent/active` y leer `/api/ai/agent/stream` (SSE).
 *
 * No persistimos el bearer: es de vida corta (TTL del token SSO). Cada
 * operación re-canjea una sesión fresca; el `conversationId` estable mantiene el
 * hilo del asistente.
 */

const TIMEOUT_MS = 15_000;

function base(): string {
  if (!env.luxipanelApiBaseUrl) throw new Error("luxipanel_not_configured");
  return env.luxipanelApiBaseUrl;
}

/**
 * Extrae el valor de la cookie de sesión que LUXIPANEL emite en /api/sso/callback.
 * El nombre lo define el backend de LUXIPANEL (`SESSION_COOKIE_NAME`, default
 * `luxipanel_session`) y lo configuramos en `env.luxipanelSessionCookieName`.
 * Aceptamos además el alias legacy `lxp_session` por compatibilidad.
 */
function extractSessionCookie(res: Response): string | null {
  // getSetCookie() (Node 18.14+) preserva múltiples Set-Cookie.
  const headers = res.headers as Headers & { getSetCookie?: () => string[] };
  const cookies = typeof headers.getSetCookie === "function" ? headers.getSetCookie() : [];
  const all = cookies.length ? cookies : [res.headers.get("set-cookie") ?? ""];
  const names = [env.luxipanelSessionCookieName, "lxp_session"].filter(Boolean);
  for (const c of all) {
    for (const name of names) {
      const re = new RegExp(`(?:^|;\\s*)${escapeRegExp(name)}=([^;]+)`);
      const m = re.exec(c);
      if (m) return decodeURIComponent(m[1]);
    }
  }
  return null;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function withTimeout<T>(fn: (signal: AbortSignal) => Promise<T>): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fn(controller.signal);
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") throw new Error("luxipanel_timeout");
    throw err instanceof Error ? err : new Error("luxipanel_request_failed");
  } finally {
    clearTimeout(timer);
  }
}

export interface LuxipanelSession {
  bearer: string;
  kind: string;
  modules: string[];
  targetName?: string;
}

/** Canjea el token SSO de LP por una sesión de LUXIPANEL. */
export async function exchangeSsoToken(ssoToken: string): Promise<LuxipanelSession> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${base()}/api/sso/callback`, {
      method: "POST",
      headers: { "content-type": "application/json", accept: "application/json" },
      body: JSON.stringify({ session: ssoToken }),
      signal
    });
    if (!res.ok) throw new Error(`luxipanel_sso_${res.status}`);
    const bearer = extractSessionCookie(res);
    if (!bearer) throw new Error("luxipanel_no_session_cookie");
    const json = (await res.json().catch(() => ({}))) as {
      data?: { kind?: string; modules?: string[]; targetName?: string };
    };
    return {
      bearer,
      kind: json.data?.kind ?? "user",
      modules: json.data?.modules ?? [],
      targetName: json.data?.targetName
    };
  });
}

function authHeaders(bearer: string): Record<string, string> {
  return {
    authorization: `Bearer ${bearer}`,
    "content-type": "application/json",
    accept: "application/json"
  };
}

/** Encola un mensaje para el asistente (cola server-side, sobrevive a cortes). */
export async function enqueueMessage(
  bearer: string,
  input: { conversationId: string; userText: string; provider?: string; withContext?: boolean }
): Promise<{ id: string; pendingCount: number }> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${base()}/api/ai/agent/enqueue`, {
      method: "POST",
      headers: authHeaders(bearer),
      body: JSON.stringify({
        conversationId: input.conversationId,
        userText: input.userText,
        provider: input.provider ?? env.luxipanelAssistantProvider,
        withContext: input.withContext ?? true
      }),
      signal
    });
    if (res.status === 403) throw new Error("luxipanel_forbidden");
    if (!res.ok) throw new Error(`luxipanel_enqueue_${res.status}`);
    const json = (await res.json()) as { id?: string; pending?: unknown[] };
    return { id: String(json.id ?? ""), pendingCount: Array.isArray(json.pending) ? json.pending.length : 0 };
  });
}

/** ¿Hay un run activo para esta conversación? */
export async function isRunActive(bearer: string, conversationId: string): Promise<boolean> {
  return withTimeout(async (signal) => {
    const res = await fetch(`${base()}/api/ai/agent/active`, {
      method: "GET",
      headers: authHeaders(bearer),
      signal
    });
    if (!res.ok) return false;
    const json = (await res.json()) as { runs?: Array<{ id: string }> };
    return (json.runs ?? []).some((r) => r.id === conversationId);
  });
}

export interface StreamResult {
  text: string;
  done: boolean;
  error?: string;
}

/**
 * Lee el SSE de `/api/ai/agent/stream` y acumula los deltas de texto hasta
 * `done`/`error` (o hasta el timeout de lectura). Devuelve el texto final para
 * enviarlo por WhatsApp. `fromSeq` permite reanudar sin repetir.
 */
export async function readResult(
  bearer: string,
  conversationId: string,
  opts: { fromSeq?: number; maxMs?: number } = {}
): Promise<StreamResult> {
  const maxMs = opts.maxMs ?? 120_000;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), maxMs);
  let text = "";
  try {
    const url = new URL(`${base()}/api/ai/agent/stream`);
    url.searchParams.set("conversationId", conversationId);
    if (opts.fromSeq != null) url.searchParams.set("fromSeq", String(opts.fromSeq));
    const res = await fetch(url.toString(), {
      method: "GET",
      headers: { authorization: `Bearer ${bearer}`, accept: "text/event-stream" },
      signal: controller.signal
    });
    if (res.status === 204) return { text: "", done: true };
    if (!res.ok || !res.body) return { text: "", done: false, error: `stream_${res.status}` };

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const frames = buffer.split("\n\n");
      buffer = frames.pop() ?? "";
      for (const frame of frames) {
        const line = frame.split("\n").find((l) => l.startsWith("data:"));
        if (!line) continue;
        let evt: { type?: string; delta?: string; message?: string };
        try {
          evt = JSON.parse(line.slice(5).trim());
        } catch {
          continue;
        }
        if (evt.type === "text" && evt.delta) text += evt.delta;
        else if (evt.type === "done") return { text, done: true };
        else if (evt.type === "error") return { text, done: true, error: evt.message ?? "error" };
      }
    }
    return { text, done: false };
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") return { text, done: false, error: "timeout" };
    return { text, done: false, error: err instanceof Error ? err.message : "stream_failed" };
  } finally {
    clearTimeout(timer);
  }
}
