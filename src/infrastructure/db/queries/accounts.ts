import type { Pool } from "pg";
import { HttpError } from "../../../errors/HttpError.js";

export type AccountRow = {
  id: string;
  project_key: string;
  firebase_uid: string;
  email: string | null;
  name: string | null;
  handle: string | null;
  phone_e164: string | null;
  phone_prefix: string | null;
  phone_local: string | null;
  whatsapp_verified: boolean;
  whatsapp_verified_at: Date | null;
};

export async function upsertAccountByFirebase(
  pool: Pool,
  input: {
    projectKey: string;
    firebaseUid: string;
    email: string | null;
    name: string | null;
  }
): Promise<AccountRow> {
  const { rows } = await pool.query(
    `insert into whatsapp_accounts (project_key, firebase_uid, email, name, metadata)
     values ($1, $2, $3, $4, '{}'::jsonb)
     on conflict (project_key, firebase_uid) do update set
       email = coalesce(excluded.email, whatsapp_accounts.email),
       name = coalesce(excluded.name, whatsapp_accounts.name),
       updated_at = now()
     returning id, project_key, firebase_uid, email, name, handle, phone_e164, phone_prefix, phone_local, whatsapp_verified, whatsapp_verified_at`,
    [input.projectKey, input.firebaseUid, input.email, input.name]
  );
  return rows[0] as AccountRow;
}

export async function findAccountByPhone(
  pool: Pool,
  projectKey: string,
  phoneE164: string
): Promise<AccountRow | null> {
  const { rows } = await pool.query(
    `select id, project_key, firebase_uid, email, name, handle, phone_e164, phone_prefix, phone_local, whatsapp_verified, whatsapp_verified_at
     from whatsapp_accounts
     where project_key = $1
       and phone_e164 = $2
     limit 1`,
    [projectKey, phoneE164]
  );
  return (rows[0] as AccountRow | undefined) ?? null;
}

export async function updateAccountPhone(
  pool: Pool,
  accountId: string,
  input: {
    name: string;
    handle: string;
    phoneLocal: string;
    phonePrefix: string;
    phoneE164: string;
  }
): Promise<AccountRow> {
  const { rows } = await pool.query(
    `update whatsapp_accounts
     set name = $1,
         handle = $2,
         phone_local = $3,
         phone_prefix = $4,
         phone_e164 = $5,
         whatsapp_verified = true,
         whatsapp_verified_at = now(),
         updated_at = now()
     where id = $6
     returning id, project_key, firebase_uid, email, name, handle, phone_e164, phone_prefix, phone_local, whatsapp_verified, whatsapp_verified_at`,
    [input.name, input.handle, input.phoneLocal, input.phonePrefix, input.phoneE164, accountId]
  );
  return rows[0] as AccountRow;
}

export async function checkHandleAvailable(
  pool: Pool,
  projectKey: string,
  handle: string,
  excludeFirebaseUid: string
): Promise<boolean> {
  const { rows } = await pool.query(
    `select 1
     from whatsapp_accounts
     where project_key = $1
       and lower(handle) = lower($2)
       and firebase_uid <> $3
     limit 1`,
    [projectKey, handle, excludeFirebaseUid]
  );
  return rows.length === 0;
}

export function requireAccountWithVerifiedPhone(account: AccountRow | null): AccountRow {
  if (!account || !account.whatsapp_verified) {
    throw new HttpError(404, "whatsapp_login_not_linked");
  }
  return account;
}
