import type { Pool } from "pg";

type LoginRequestRow = {
  phone_e164: string;
  verified_at: Date | null;
  expires_at: Date;
};

export async function insertLoginRequest(
  pool: Pool,
  input: {
    projectKey: string;
    sessionId: string;
    phoneE164: string;
    code: string;
    expiresAt: Date;
  }
): Promise<void> {
  await pool.query(
    `insert into whatsapp_login_requests (project_key, session_id, phone_e164, code, expires_at, attempts)
     values ($1,$2,$3,$4,$5,0)`,
    [input.projectKey, input.sessionId, input.phoneE164, input.code, input.expiresAt]
  );
}

export async function findLoginRequest(
  pool: Pool,
  projectKey: string,
  sessionId: string
): Promise<LoginRequestRow | null> {
  const { rows } = await pool.query(
    `select phone_e164, verified_at, expires_at
     from whatsapp_login_requests
     where project_key = $1
       and session_id = $2
     limit 1`,
    [projectKey, sessionId]
  );
  return (rows[0] as LoginRequestRow | undefined) ?? null;
}
