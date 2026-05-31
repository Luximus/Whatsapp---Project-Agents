import { getLinkStore, type LinkStoreHost } from "./factory.js";
import { getConnector } from "./registry.js";
import { ensureAuthenticated } from "./authGate.js";
import { lpClient } from "./lpClient.js";
import {
  exchangeSsoToken,
  enqueueMessage,
  isRunActive,
  readResult
} from "./luxipanelClient.js";
import type { AccountLink } from "./types.js";

/**
 * Orquestación de "operar un servidor en background por el asistente IA de
 * LUXIPANEL desde WhatsApp" (Fase 2). Es específica del servicio `luxipanel`
 * (capabilities().serverAssistant). El cobro por MB lo hace LP-LS sobre el
 * tráfico del gateway SSH (ssh-data-meter), no aquí.
 *
 * No persistimos el bearer de LUXIPANEL (vida corta). Cada operación re-emite
 * una sesión SSO fresca por loopback y la canjea; el `conversationId` estable
 * mantiene el hilo del asistente entre mensajes.
 */

/** conversationId determinista por (teléfono, target) → reanuda el hilo. */
function conversationIdFor(phoneE164: string, targetId: string): string {
  const digits = phoneE164.replace(/\D/g, "");
  return `wa-${digits}-${targetId.slice(0, 8)}`;
}

async function requireLuxipanelLink(
  host: LinkStoreHost,
  phoneE164: string
): Promise<AccountLink | null> {
  const connector = getConnector("luxipanel");
  if (!connector || !connector.capabilities().serverAssistant) return null;
  return getLinkStore(host).getLink(phoneE164, "luxipanel");
}

/** Abre una sesión LUXIPANEL fresca para un target (issue SSO → canje). */
async function openBearer(
  customerId: string,
  targetId: string
): Promise<{ bearer: string; kind: string; modules: string[]; lpSessionId: string }> {
  const issued = await lpClient.issueSessionForLinked({ customerId, targetId, source: "whatsapp_agent" });
  const session = await exchangeSsoToken(issued.sessionToken);
  return { bearer: session.bearer, kind: session.kind, modules: session.modules, lpSessionId: issued.sessionId };
}

export type ConnectResult =
  | { status: "not_linked" }
  | { status: "auth_required" }
  | { status: "no_servers" }
  | { status: "disabled" }
  | {
      status: "choose";
      servers: Array<{ id: string; name: string; linuxUser: string; panel?: string; enabled: boolean }>;
    }
  | { status: "connected"; serverName: string; linuxUser: string; conversationId: string }
  | { status: "error"; message: string };

/** Conecta a un servidor del cliente; pregunta con qué usuario SSH si hay varios. */
export async function connectServer(
  host: LinkStoreHost,
  input: { phoneE164: string; targetId?: string }
): Promise<ConnectResult> {
  const link = await requireLuxipanelLink(host, input.phoneE164);
  if (!link) return { status: "not_linked" };
  if (!(await ensureAuthenticated(host, input.phoneE164))) return { status: "auth_required" };
  try {
    const all = await lpClient.listServers(link.accountId);
    // Solo se puede conectar con accesos SSH habilitados.
    const servers = all.filter((s) => s.enabled !== false);
    if (!all.length) return { status: "no_servers" };

    let target = input.targetId ? all.find((s) => s.id === input.targetId) : undefined;
    if (target && target.enabled === false) return { status: "disabled" };
    if (!target) {
      // Pregunta SIEMPRE con qué usuario SSH conectar (salvo que haya exactamente uno).
      if (servers.length !== 1) {
        return {
          status: "choose",
          servers: servers.map((s) => ({
            id: s.id,
            name: s.name,
            linuxUser: s.linuxUser,
            panel: s.panel?.name,
            enabled: s.enabled !== false
          }))
        };
      }
      target = servers[0];
    }

    const opened = await openBearer(link.accountId, target.id);
    const conversationId = conversationIdFor(input.phoneE164, target.id);
    await getLinkStore(host).saveServerSession({
      phoneE164: input.phoneE164,
      serviceId: "luxipanel",
      accountId: link.accountId,
      targetId: target.id,
      conversationId,
      lpSessionId: opened.lpSessionId,
      status: "active"
    });
    return { status: "connected", serverName: target.name, linuxUser: target.linuxUser, conversationId };
  } catch (err) {
    host?.log?.warn?.({ err }, "connectServer_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

export type AssistantResult =
  | { status: "no_session" }
  | { status: "auth_required" }
  | { status: "forbidden" }
  | { status: "answer"; text: string }
  | { status: "working" }
  | { status: "error"; message: string };

/**
 * Envía un mensaje al asistente del servidor conectado y espera el resultado
 * hasta `maxMs`. Si no termina a tiempo, devuelve `working` (usar assistantPoll).
 */
export async function assistantSend(
  host: LinkStoreHost,
  input: { phoneE164: string; text: string; maxMs?: number }
): Promise<AssistantResult> {
  const store = getLinkStore(host);
  if (!(await ensureAuthenticated(host, input.phoneE164))) return { status: "auth_required" };
  const session = await store.getServerSession(input.phoneE164, "luxipanel");
  if (!session) return { status: "no_session" };
  try {
    const opened = await openBearer(session.accountId, session.targetId);
    await enqueueMessage(opened.bearer, {
      conversationId: session.conversationId,
      userText: input.text
    });
    const res = await readResult(opened.bearer, session.conversationId, {
      maxMs: input.maxMs ?? 90_000
    });
    if (res.error === "luxipanel_forbidden") return { status: "forbidden" };
    if (res.done) return { status: "answer", text: res.text };
    if (res.text.trim()) return { status: "answer", text: res.text };
    return { status: "working" };
  } catch (err) {
    if (err instanceof Error && err.message === "luxipanel_forbidden") return { status: "forbidden" };
    host?.log?.warn?.({ err }, "assistantSend_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

/** Reanuda la lectura del último run (para respuestas largas). */
export async function assistantPoll(
  host: LinkStoreHost,
  input: { phoneE164: string }
): Promise<AssistantResult> {
  const store = getLinkStore(host);
  if (!(await ensureAuthenticated(host, input.phoneE164))) return { status: "auth_required" };
  const session = await store.getServerSession(input.phoneE164, "luxipanel");
  if (!session) return { status: "no_session" };
  try {
    const opened = await openBearer(session.accountId, session.targetId);
    const active = await isRunActive(opened.bearer, session.conversationId);
    const res = await readResult(opened.bearer, session.conversationId, { maxMs: 90_000 });
    if (res.text.trim()) return { status: "answer", text: res.text };
    return active ? { status: "working" } : { status: "answer", text: "" };
  } catch (err) {
    host?.log?.warn?.({ err }, "assistantPoll_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

/** Cierra la sesión a servidor activa (deja de re-emitir; la sesión LP expira sola). */
export async function disconnectServer(
  host: LinkStoreHost,
  input: { phoneE164: string }
): Promise<{ status: "disconnected" | "no_session" }> {
  const store = getLinkStore(host);
  const session = await store.getServerSession(input.phoneE164, "luxipanel");
  if (!session) return { status: "no_session" };
  await store.endServerSession(input.phoneE164, "luxipanel");
  return { status: "disconnected" };
}

// Watchers activos (uno por teléfono+servicio) para no duplicar el push.
const watching = new Set<string>();

/**
 * Espera a que termine el run en curso y devuelve el texto final (o null si no
 * hay nada/expira). Pensado para el push en segundo plano: la CAPA DE RUTAS lo
 * llama tras un `working` y envía el resultado por WhatsApp. Garantiza un solo
 * watcher por (teléfono, luxipanel).
 */
export async function awaitCompletion(
  host: LinkStoreHost,
  input: { phoneE164: string; maxMs?: number }
): Promise<string | null> {
  const key = `${input.phoneE164}::luxipanel`;
  if (watching.has(key)) return null;
  watching.add(key);
  try {
    const session = await getLinkStore(host).getServerSession(input.phoneE164, "luxipanel");
    if (!session) return null;
    const opened = await openBearer(session.accountId, session.targetId);
    const res = await readResult(opened.bearer, session.conversationId, {
      maxMs: input.maxMs ?? 300_000
    });
    const text = res.text.trim();
    return text || null;
  } catch (err) {
    host?.log?.warn?.({ err }, "awaitCompletion_failed");
    return null;
  } finally {
    watching.delete(key);
  }
}

export type SwitchResult = ConnectResult;

/** Cambia el servidor activo (cierra la sesión actual y conecta al nuevo target). */
export async function switchConnection(
  host: LinkStoreHost,
  input: { phoneE164: string; targetId: string }
): Promise<SwitchResult> {
  await getLinkStore(host).endServerSession(input.phoneE164, "luxipanel");
  return connectServer(host, { phoneE164: input.phoneE164, targetId: input.targetId });
}

export interface ServerListResult {
  status: "ok" | "not_linked" | "auth_required" | "error";
  servers?: Array<{
    id: string;
    name: string;
    host: string;
    port?: number;
    linuxUser: string;
    enabled: boolean;
    status: string | null;
    panel?: string;
  }>;
  message?: string;
}

/** Lista los accesos SSH del cliente (usuario, host, panel, estado). Requiere 2FA. */
export async function listServers(
  host: LinkStoreHost,
  input: { phoneE164: string }
): Promise<ServerListResult> {
  const link = await requireLuxipanelLink(host, input.phoneE164);
  if (!link) return { status: "not_linked" };
  if (!(await ensureAuthenticated(host, input.phoneE164))) return { status: "auth_required" };
  try {
    const servers = await lpClient.listServers(link.accountId);
    return {
      status: "ok",
      servers: servers.map((s) => ({
        id: s.id,
        name: s.name,
        host: s.host,
        port: s.port,
        linuxUser: s.linuxUser,
        enabled: s.enabled !== false,
        status: s.status,
        panel: s.panel?.name
      }))
    };
  } catch (err) {
    host?.log?.warn?.({ err }, "listServers_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

export type SetSshEnabledResult =
  | { status: "ok"; name: string; enabled: boolean }
  | { status: "not_linked" }
  | { status: "auth_required" }
  | { status: "not_found" }
  | { status: "error"; message: string };

/** Activa/desactiva (soft-disable) un acceso SSH del cliente. Requiere 2FA. */
export async function setSshEnabled(
  host: LinkStoreHost,
  input: { phoneE164: string; targetId: string; enabled: boolean }
): Promise<SetSshEnabledResult> {
  const link = await requireLuxipanelLink(host, input.phoneE164);
  if (!link) return { status: "not_linked" };
  if (!(await ensureAuthenticated(host, input.phoneE164))) return { status: "auth_required" };
  try {
    const r = await lpClient.setSshEnabled(link.accountId, input.targetId, input.enabled);
    // Si se desactiva el acceso actualmente conectado, cerrar su sesión.
    if (!input.enabled) {
      const sess = await getLinkStore(host).getServerSession(input.phoneE164, "luxipanel");
      if (sess && sess.targetId === input.targetId) {
        await getLinkStore(host).endServerSession(input.phoneE164, "luxipanel");
      }
    }
    return { status: "ok", name: r.name, enabled: r.enabled };
  } catch (err) {
    const msg = err instanceof Error ? err.message : "error";
    if (msg.includes("404") || msg.includes("not_found")) return { status: "not_found" };
    host?.log?.warn?.({ err }, "setSshEnabled_failed");
    return { status: "error", message: msg };
  }
}
