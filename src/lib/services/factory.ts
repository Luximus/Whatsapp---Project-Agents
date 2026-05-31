import { MemoryLinkStore } from "./memoryStore.js";
import { PostgresLinkStore } from "./postgresStore.js";
import type { LinkStore, PgLike } from "./store.js";

export interface LinkStoreHost {
  pg?: PgLike;
  log?: { warn?: (obj: unknown, msg?: string) => void };
}

let memorySingleton: MemoryLinkStore | null = null;
let postgresSingleton: PostgresLinkStore | null = null;

/**
 * Resuelve el store de vínculos: Postgres si hay pool `fastify.pg` (persiste
 * entre reinicios), o memoria como fallback.
 */
export function getLinkStore(host?: LinkStoreHost): LinkStore {
  const pool = host?.pg;
  if (pool) {
    if (!postgresSingleton) postgresSingleton = new PostgresLinkStore(pool);
    return postgresSingleton;
  }
  if (!memorySingleton) memorySingleton = new MemoryLinkStore();
  return memorySingleton;
}

/** Resetea los singletons (solo para tests). */
export function resetLinkStores() {
  memorySingleton = null;
  postgresSingleton = null;
}
