import { env } from "../../env.js";
import { MemoryBridgeStore } from "./memoryStore.js";
import { PostgresBridgeStore, type PgLike } from "./postgresStore.js";
import type { BridgeStore } from "./store.js";

// Singleton del store en memoria (su estado vive en el proceso).
let memorySingleton: MemoryBridgeStore | null = null;
// Singleton del store Postgres por pool (normalmente uno solo).
let postgresSingleton: PostgresBridgeStore | null = null;

/**
 * Resuelve el store del Bridge según `BRIDGE_STORE`:
 *   - "postgres" si hay un pool `fastify.pg` disponible y el env lo pide.
 *   - "memory" en cualquier otro caso (DEFAULT seguro: no cambia producción
 *     hasta activarlo explícitamente y verificarlo).
 *
 * Si se pide postgres pero no hay pool, cae a memoria (no debe tumbar el
 * arranque del Bridge OTP).
 */
export function getBridgeStore(fastify?: { pg?: PgLike; log?: any }): BridgeStore {
  const wantPostgres = env.bridgeStore === "postgres";
  const pool = fastify?.pg;

  if (wantPostgres && pool) {
    if (!postgresSingleton) {
      postgresSingleton = new PostgresBridgeStore(pool);
    }
    return postgresSingleton;
  }

  if (wantPostgres && !pool) {
    fastify?.log?.warn?.("BRIDGE_STORE=postgres but no pg pool available; falling back to memory");
  }

  if (!memorySingleton) {
    memorySingleton = new MemoryBridgeStore();
  }
  return memorySingleton;
}

/** Resetea los singletons (solo para tests). */
export function resetBridgeStores() {
  memorySingleton = null;
  postgresSingleton = null;
}
