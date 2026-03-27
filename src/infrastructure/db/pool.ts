import { Pool } from "pg";
import { env } from "../../config/env.js";

let _pool: Pool | null = null;

export function getPool(): Pool {
  if (!_pool) _pool = new Pool({ connectionString: env.DATABASE_URL });
  return _pool;
}

export async function closePool(): Promise<void> {
  if (_pool) {
    await _pool.end();
    _pool = null;
  }
}
