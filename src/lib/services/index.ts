import { env } from "../../env.js";
import { getLinkStore, type LinkStoreHost } from "./factory.js";
import { getConnector, listConnectors } from "./registry.js";
import { ensureAuthenticated } from "./authGate.js";
import type { AccountLink, ServiceConnector } from "./types.js";

export * from "./types.js";
export { getConnector, listConnectors } from "./registry.js";
export { getLinkStore, resetLinkStores } from "./factory.js";
export type { LinkStoreHost } from "./factory.js";
export type { LinkStore } from "./store.js";
export { ensureAuthenticated } from "./authGate.js";
export {
  connectServer,
  assistantSend,
  assistantPoll,
  switchConnection,
  listServers,
  setSshEnabled,
  disconnectServer,
  awaitCompletion
} from "./serverAssistant.js";

/** Abre/renueva la sesión 2FA del chat para el teléfono. */
async function openAuth(
  host: LinkStoreHost,
  phoneE164: string,
  connector: ServiceConnector,
  accountId: string,
  method = "totp"
): Promise<void> {
  await getLinkStore(host).openAuthSession({
    phoneE164,
    serviceId: connector.id,
    accountId,
    method,
    ttlSeconds: env.authSessionTtlSeconds
  });
}

export type StartLinkResult =
  | { status: "linked"; serviceName: string; displayName?: string | null }
  | { status: "need_2fa_code"; serviceName: string; displayName?: string | null }
  | { status: "already_linked"; serviceName: string; displayName?: string | null }
  | { status: "unknown_service" }
  | { status: "unavailable"; serviceName: string }
  | { status: "needs_2fa"; serviceName: string }
  | { status: "2fa_unavailable"; serviceName: string }
  // El teléfono aún NO está verificado por WhatsApp en la cuenta (OTP en Ajustes).
  // Es el prerrequisito para enlazar y operar servicios por el chat.
  | { status: "needs_whatsapp_verification"; serviceName: string }
  | { status: "not_found"; serviceName: string }
  | { status: "error"; serviceName?: string; message: string };

/**
 * Inicia el vínculo. 2FA OBLIGATORIO: localiza la cuenta por teléfono, exige que
 * tenga 2FA activo y crea un intento pendiente que se confirma con el código 2FA
 * (TOTP) de la app del usuario. No se envía ningún código por el chat (el
 * segundo factor es el TOTP que el usuario ya posee en su app autenticadora).
 */
export async function startLink(
  host: LinkStoreHost,
  input: { phoneE164: string; serviceId: string }
): Promise<StartLinkResult> {
  const connector = getConnector(input.serviceId);
  if (!connector) return { status: "unknown_service" };
  if (!connector.capabilities().profile) {
    return { status: "unavailable", serviceName: connector.name };
  }

  const store = getLinkStore(host);
  try {
    const existing = await store.getLink(input.phoneE164, connector.id);
    if (existing) {
      return {
        status: "already_linked",
        serviceName: connector.name,
        displayName: existing.displayName
      };
    }

    const candidate = await connector.findAccountByPhone(input.phoneE164);
    if (!candidate) return { status: "not_found", serviceName: connector.name };

    // Prerrequisito de enlace: el teléfono debe estar VERIFICADO por WhatsApp en
    // la cuenta (OTP hecho en Ajustes de LUXIPANEL/portal/app/desktop). Esa
    // verificación ya probó la posesión del número (la Cloud API solo entrega el
    // código a ese mismo número), así que el enlace se crea directo, sin pedir un
    // TOTP de nuevo. Si no está verificado, se instruye al usuario a hacerlo.
    if (!candidate.whatsappVerified) {
      return { status: "needs_whatsapp_verification", serviceName: connector.name };
    }

    await store.saveLink({
      phoneE164: input.phoneE164,
      serviceId: connector.id,
      accountId: candidate.accountId,
      displayName: candidate.displayName ?? null,
      metadata: candidate.metadata ?? {},
      verifiedAt: new Date()
    });
    // Posesión del número ya probada por el OTP de cuenta → abrir sesión del chat.
    await openAuth(host, input.phoneE164, connector, candidate.accountId, "whatsapp_otp");
    return {
      status: "linked",
      serviceName: connector.name,
      displayName: candidate.displayName
    };
  } catch (err) {
    host?.log?.warn?.({ err, serviceId: connector.id }, "startLink_failed");
    return {
      status: "error",
      serviceName: connector.name,
      message: err instanceof Error ? err.message : "error"
    };
  }
}

export type ConfirmLinkResult =
  | { status: "linked"; serviceName: string; displayName?: string | null }
  | { status: "invalid"; serviceName: string }
  | { status: "expired"; serviceName: string }
  | { status: "none"; serviceName: string }
  | { status: "unknown_service" }
  | { status: "error"; serviceName?: string; message: string };

/** Confirma el vínculo con el código 2FA (TOTP). Persiste y abre sesión 2FA. */
export async function confirmLink(
  host: LinkStoreHost,
  input: { phoneE164: string; serviceId: string; code: string }
): Promise<ConfirmLinkResult> {
  const result = await confirmPendingLink(host, { phoneE164: input.phoneE164, code: input.code });
  const connector = getConnector(input.serviceId);
  const serviceName = connector?.name ?? input.serviceId;
  switch (result.status) {
    case "linked":
      return { status: "linked", serviceName: result.serviceName, displayName: result.displayName };
    case "none":
      return { status: "none", serviceName };
    case "invalid":
      return { status: "invalid", serviceName };
    case "expired":
      return { status: "expired", serviceName };
    case "error":
      return { status: "error", serviceName, message: result.message };
    default:
      return { status: "error", serviceName, message: "unexpected" };
  }
}

export type UnlinkResult =
  | { status: "unlinked"; serviceName: string }
  | { status: "not_linked"; serviceName: string }
  | { status: "unknown_service" };

/** Desvincula la cuenta de un servicio y cierra cualquier sesión a servidor. */
export async function unlinkAccount(
  host: LinkStoreHost,
  input: { phoneE164: string; serviceId: string }
): Promise<UnlinkResult> {
  const connector = getConnector(input.serviceId);
  if (!connector) return { status: "unknown_service" };
  const store = getLinkStore(host);
  const existing = await store.getLink(input.phoneE164, connector.id);
  if (!existing) return { status: "not_linked", serviceName: connector.name };
  await store.endServerSession(input.phoneE164, connector.id);
  await store.revokeLink(input.phoneE164, connector.id);
  return { status: "unlinked", serviceName: connector.name };
}

export type ConfirmPendingResult =
  | { status: "linked"; serviceName: string; displayName?: string | null }
  | { status: "invalid" }
  | { status: "expired" }
  | { status: "none" }
  | { status: "error"; message: string };

/**
 * Confirma de forma DETERMINISTA un intento de vínculo pendiente cuando llega un
 * código suelto por WhatsApp. El código es el 2FA (TOTP) de la app del usuario;
 * se verifica contra el servicio. Al confirmarse, persiste el vínculo Y abre la
 * sesión 2FA del chat. Devuelve `none` si no hay vínculo pendiente (para que el
 * webhook siga su curso: verificación de cuenta, re-auth o agente).
 */
export async function confirmPendingLink(
  host: LinkStoreHost,
  input: { phoneE164: string; code: string }
): Promise<ConfirmPendingResult> {
  const store = getLinkStore(host);
  const code = String(input.code ?? "").trim();
  try {
    const pending = await store.getActivePendingLink(input.phoneE164);
    if (!pending) return { status: "none" };
    if (pending.expired) {
      return { status: "expired" };
    }
    const connector = getConnector(pending.serviceId);
    if (!connector) return { status: "none" };

    let verified = false;
    if (pending.via === "totp") {
      if (typeof connector.verify2fa !== "function") return { status: "none" };
      verified = await connector.verify2fa(pending.accountId, code);
    } else {
      verified = pending.code === code;
    }

    if (!verified) {
      const status = await store.bumpPendingAttempt(pending.id, env.linkOtpMaxAttempts);
      return { status };
    }

    await store.markPendingVerified(pending.id);
    await store.saveLink({
      phoneE164: input.phoneE164,
      serviceId: pending.serviceId,
      accountId: pending.accountId,
      displayName: pending.displayName ?? null,
      metadata: pending.metadata ?? {},
      verifiedAt: new Date()
    });
    // Vincular = autenticación 2FA fresca → abrir sesión del chat.
    await openAuth(host, input.phoneE164, connector, pending.accountId);
    return {
      status: "linked",
      serviceName: connector.name,
      displayName: pending.displayName
    };
  } catch (err) {
    host?.log?.warn?.({ err }, "confirmPendingLink_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

export type AuthenticateResult =
  | { status: "authenticated"; serviceName: string }
  | { status: "invalid" }
  | { status: "not_linked" }
  | { status: "error"; message: string };

/**
 * Re-autentica el chat con un código 2FA (TOTP) de una cuenta vinculada. Abre/
 * renueva la sesión 2FA (TTL deslizante). Si no se indica servicio, usa el primer
 * vínculo que soporte verificación 2FA.
 */
export async function authenticate(
  host: LinkStoreHost,
  input: { phoneE164: string; service?: string; code: string }
): Promise<AuthenticateResult> {
  const store = getLinkStore(host);
  const code = String(input.code ?? "").trim();
  try {
    const links = await store.listLinks(input.phoneE164);
    if (!links.length) return { status: "not_linked" };

    const pick = input.service
      ? links.find((l) => getConnector(l.serviceId)?.id === getConnector(input.service!)?.id)
      : links.find((l) => typeof getConnector(l.serviceId)?.verify2fa === "function");
    const link = pick ?? links[0];
    const connector = getConnector(link.serviceId);
    if (!connector || typeof connector.verify2fa !== "function") return { status: "not_linked" };

    const ok = await connector.verify2fa(link.accountId, code);
    if (!ok) return { status: "invalid" };

    await openAuth(host, input.phoneE164, connector, link.accountId);
    return { status: "authenticated", serviceName: connector.name };
  } catch (err) {
    host?.log?.warn?.({ err }, "authenticate_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

/** Purga sesiones 2FA inactivas (>TTL) y borra su chat + sesiones a servidor. */
export async function purgeInactiveSessions(host: LinkStoreHost): Promise<string[]> {
  try {
    return await getLinkStore(host).purgeInactive(env.authSessionTtlSeconds);
  } catch (err) {
    host?.log?.warn?.({ err }, "purgeInactiveSessions_failed");
    return [];
  }
}

export interface LinkedAccountView {
  serviceId: string;
  serviceName: string;
  displayName?: string | null;
}

/** Lista los servicios vinculados al número (con nombre legible). */
export async function listLinkedAccounts(
  host: LinkStoreHost,
  phoneE164: string
): Promise<LinkedAccountView[]> {
  const store = getLinkStore(host);
  const links = await store.listLinks(phoneE164);
  return links.map((l) => ({
    serviceId: l.serviceId,
    serviceName: getConnector(l.serviceId)?.name ?? l.serviceId,
    displayName: l.displayName
  }));
}

async function requireLink(
  host: LinkStoreHost,
  phoneE164: string,
  serviceId: string
): Promise<{ connector: ReturnType<typeof getConnector>; link: AccountLink | null }> {
  const connector = getConnector(serviceId);
  if (!connector) return { connector: null, link: null };
  const link = await getLinkStore(host).getLink(phoneE164, connector.id);
  return { connector, link };
}

export type ServiceCallResult =
  | { status: "ok"; data: unknown }
  | { status: "not_linked"; serviceName?: string }
  | { status: "auth_required" }
  | { status: "unknown_service" }
  | { status: "error"; message: string };

/** Devuelve el perfil/cuenta del servicio vinculado. Requiere sesión 2FA. */
export async function getAccountInfo(
  host: LinkStoreHost,
  input: { phoneE164: string; serviceId: string }
): Promise<ServiceCallResult> {
  const { connector, link } = await requireLink(host, input.phoneE164, input.serviceId);
  if (!connector) return { status: "unknown_service" };
  if (!link) return { status: "not_linked", serviceName: connector.name };
  if (!(await ensureAuthenticated(host, input.phoneE164))) return { status: "auth_required" };
  try {
    return { status: "ok", data: await connector.getProfile(link) };
  } catch (err) {
    host?.log?.warn?.({ err, serviceId: connector.id }, "getAccountInfo_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

/** Acceso genérico a la API del servicio vinculado. Requiere sesión 2FA. */
export async function callServiceApi(
  host: LinkStoreHost,
  input: { phoneE164: string; serviceId: string; action: string; params?: Record<string, unknown> }
): Promise<ServiceCallResult> {
  const { connector, link } = await requireLink(host, input.phoneE164, input.serviceId);
  if (!connector) return { status: "unknown_service" };
  if (!link) return { status: "not_linked", serviceName: connector.name };
  if (!(await ensureAuthenticated(host, input.phoneE164))) return { status: "auth_required" };
  try {
    return { status: "ok", data: await connector.callApi(link, { action: input.action, params: input.params }) };
  } catch (err) {
    host?.log?.warn?.({ err, serviceId: connector.id, action: input.action }, "callServiceApi_failed");
    return { status: "error", message: err instanceof Error ? err.message : "error" };
  }
}

/** Nombres legibles de los servicios disponibles (para el prompt/ayuda). */
export function availableServices(): { id: string; name: string }[] {
  return listConnectors()
    .filter((c) => c.capabilities().profile)
    .map((c) => ({ id: c.id, name: c.name }));
}
