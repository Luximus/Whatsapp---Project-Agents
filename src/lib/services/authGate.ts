import { env } from "../../env.js";
import { getLinkStore, type LinkStoreHost } from "./factory.js";

/**
 * Puerta de 2FA para acciones de cuenta/servidor. Si hay una sesión 2FA viva
 * para el teléfono, la renueva (sliding TTL) y deja pasar; si no, deniega.
 * Las acciones sensibles deben llamar esto antes de operar.
 */
export async function ensureAuthenticated(
  host: LinkStoreHost,
  phoneE164: string
): Promise<boolean> {
  const store = getLinkStore(host);
  const session = await store.getAuthSession(phoneE164);
  if (!session) return false;
  await store.touchAuthSession(phoneE164, env.authSessionTtlSeconds);
  return true;
}
