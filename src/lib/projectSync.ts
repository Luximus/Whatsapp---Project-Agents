import { Pool } from "pg";
import { env } from "../env.js";

const projectPools = new Map<string, Pool>();

function normalizeProjectKey(projectKey: string) {
  return projectKey.trim().toLowerCase();
}

function getProjectDatabaseUrl(projectKey: string) {
  return env.projectDatabases[normalizeProjectKey(projectKey)] ?? null;
}

function getProjectPool(projectKey: string) {
  const normalized = normalizeProjectKey(projectKey);
  const existing = projectPools.get(normalized);
  if (existing) return existing;

  const connectionString = getProjectDatabaseUrl(normalized);
  if (!connectionString) return null;

  const pool = new Pool({ connectionString });
  projectPools.set(normalized, pool);
  return pool;
}

export type ProjectUser = {
  firebase_uid: string;
  email: string | null;
  name: string | null;
  handle: string | null;
  phone: string | null;
  phone_prefix: string | null;
  whatsapp_number: string | null;
  whatsapp_verified: boolean;
};

export async function findProjectUserByPhone(projectKey: string, phoneE164: string): Promise<ProjectUser | null> {
  const pool = getProjectPool(projectKey);
  if (!pool) return null;

  try {
    const { rows } = await pool.query(
      `select firebase_uid, email, name, handle, phone, phone_prefix, whatsapp_number, whatsapp_verified
       from users
       where whatsapp_number = $1
       limit 1`,
      [phoneE164]
    );
    const row = rows[0] as Partial<ProjectUser> | undefined;
    if (!row?.firebase_uid) return null;
    return {
      firebase_uid: String(row.firebase_uid),
      email: row.email ?? null,
      name: row.name ?? null,
      handle: row.handle ?? null,
      phone: row.phone ?? null,
      phone_prefix: row.phone_prefix ?? null,
      whatsapp_number: row.whatsapp_number ?? null,
      whatsapp_verified: Boolean(row.whatsapp_verified)
    };
  } catch {
    return null;
  }
}

export async function syncProjectUserByFirebaseUid(input: {
  projectKey: string;
  firebaseUid: string;
  name?: string | null;
  handle?: string | null;
  phoneLocal?: string | null;
  phonePrefix?: string | null;
  phoneE164?: string | null;
  whatsappVerified: boolean;
}) {
  const pool = getProjectPool(input.projectKey);
  if (!pool) return false;

  try {
    await pool.query(
      `update users
       set name = coalesce($2, name),
           handle = coalesce($3, handle),
           phone = coalesce($4, phone),
           phone_prefix = coalesce($5, phone_prefix),
           whatsapp_number = coalesce($6, whatsapp_number),
           whatsapp_verified = $7,
           whatsapp_verified_at = case when $7 then now() else whatsapp_verified_at end,
           updated_at = now()
       where firebase_uid = $1`,
      [
        input.firebaseUid,
        input.name ?? null,
        input.handle ?? null,
        input.phoneLocal ?? null,
        input.phonePrefix ?? null,
        input.phoneE164 ?? null,
        input.whatsappVerified
      ]
    );
    return true;
  } catch {
    return false;
  }
}

export async function closeProjectPools() {
  for (const pool of projectPools.values()) {
    await pool.end();
  }
  projectPools.clear();
}
