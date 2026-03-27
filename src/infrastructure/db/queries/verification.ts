import type { Pool } from "pg";

type VerificationRow = {
  attempts: number;
  expires_at: Date;
  verified_at: Date | null;
};

type PendingVerificationRow = {
  phone_e164: string;
  expires_at: Date;
};

export async function findActiveVerification(
  pool: Pool,
  projectKey: string,
  accountId: string
): Promise<VerificationRow | null> {
  const { rows } = await pool.query(
    `select attempts, expires_at, verified_at
     from whatsapp_verification_requests
     where project_key = $1 and account_id = $2
     limit 1`,
    [projectKey, accountId]
  );
  return (rows[0] as VerificationRow | undefined) ?? null;
}

export async function upsertVerification(
  pool: Pool,
  input: {
    projectKey: string;
    accountId: string;
    phoneE164: string;
    code: string;
    expiresAt: Date;
  }
): Promise<void> {
  await pool.query(
    `insert into whatsapp_verification_requests (project_key, account_id, phone_e164, code, expires_at, attempts)
     values ($1,$2,$3,$4,$5,0)
     on conflict (project_key, account_id) do update set
       phone_e164 = excluded.phone_e164,
       code = excluded.code,
       expires_at = excluded.expires_at,
       attempts = 0,
       verified_at = null,
       updated_at = now()`,
    [input.projectKey, input.accountId, input.phoneE164, input.code, input.expiresAt]
  );
}

export async function findPendingVerification(
  pool: Pool,
  projectKey: string,
  accountId: string
): Promise<PendingVerificationRow | null> {
  const { rows } = await pool.query(
    `select phone_e164, expires_at
     from whatsapp_verification_requests
     where project_key = $1
       and account_id = $2
       and verified_at is null
       and expires_at > now()
     order by created_at desc
     limit 1`,
    [projectKey, accountId]
  );
  return (rows[0] as PendingVerificationRow | undefined) ?? null;
}
