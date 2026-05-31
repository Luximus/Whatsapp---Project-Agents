import { MemoryConversationStore } from "./memoryStore.js";
import { PostgresConversationStore } from "./postgresStore.js";
import type { ConversationStore, PgLike } from "./store.js";

export interface ConversationStoreHost {
  pg?: PgLike;
  log?: { warn?: (obj: unknown, msg?: string) => void };
}

let memorySingleton: MemoryConversationStore | null = null;
let postgresSingleton: PostgresConversationStore | null = null;

/**
 * Resuelve el store de memoria de conversación: Postgres si hay pool `fastify.pg`
 * (persiste entre reinicios), o memoria como fallback (no debe tumbar el webhook
 * si la BD no está disponible).
 */
export function getConversationStore(host?: ConversationStoreHost): ConversationStore {
  const pool = host?.pg;
  if (pool) {
    if (!postgresSingleton) postgresSingleton = new PostgresConversationStore(pool);
    return postgresSingleton;
  }
  if (!memorySingleton) memorySingleton = new MemoryConversationStore();
  return memorySingleton;
}

/** Resetea los singletons (solo para tests). */
export function resetConversationStores() {
  memorySingleton = null;
  postgresSingleton = null;
}
