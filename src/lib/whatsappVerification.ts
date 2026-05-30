const MAX_WHATSAPP_VERIFICATION_ATTEMPTS = 5;

type VerificationRequestKind = "verification" | "login" | "register" | "recovery";

type PendingVerificationRow = {
  kind: VerificationRequestKind;
  id: number;
  project_key: string;
  account_id: string | null;
  phone_e164: string;
  code: string;
  expires_at: Date;
  attempts: number;
  created_at: Date;
};

function tableNameForKind(kind: VerificationRequestKind) {
  switch (kind) {
    case "verification":
      return "whatsapp_verification_requests";
    case "login":
      return "whatsapp_login_requests";
    case "register":
      return "whatsapp_register_requests";
    case "recovery":
      return "whatsapp_recovery_requests";
  }
}

async function loadPendingRequests(client: any, phoneE164: string): Promise<PendingVerificationRow[]> {
  const { rows } = await client.query(
    `select *
     from (
       select
         'verification'::text as kind,
         id,
         project_key,
         account_id::text as account_id,
         phone_e164,
         code,
         expires_at,
         attempts,
         created_at
       from whatsapp_verification_requests
       where phone_e164 = $1
         and verified_at is null

       union all

       select
         'login'::text as kind,
         id,
         project_key,
         null::text as account_id,
         phone_e164,
         code,
         expires_at,
         attempts,
         created_at
       from whatsapp_login_requests
       where phone_e164 = $1
         and verified_at is null

       union all

       select
         'register'::text as kind,
         id,
         project_key,
         null::text as account_id,
         phone_e164,
         code,
         expires_at,
         attempts,
         created_at
       from whatsapp_register_requests
       where phone_e164 = $1
         and verified_at is null

       union all

       select
         'recovery'::text as kind,
         id,
         project_key,
         null::text as account_id,
         phone_e164,
         code,
         expires_at,
         attempts,
         created_at
       from whatsapp_recovery_requests
       where phone_e164 = $1
         and verified_at is null
     ) pending
     order by pending.created_at desc, pending.id desc`,
    [phoneE164]
  );

  return rows as PendingVerificationRow[];
}

async function expirePendingRequest(client: any, row: PendingVerificationRow) {
  const tableName = tableNameForKind(row.kind);
  await client.query(
    `update ${tableName}
     set expires_at = least(expires_at, now())
     where id = $1
       and verified_at is null`,
    [row.id]
  );
}

async function registerInvalidAttempt(client: any, row: PendingVerificationRow) {
  const tableName = tableNameForKind(row.kind);
  const exhausted = row.attempts + 1 >= MAX_WHATSAPP_VERIFICATION_ATTEMPTS;

  await client.query(
    exhausted
      ? `update ${tableName}
         set attempts = attempts + 1,
             expires_at = now()
         where id = $1
           and verified_at is null`
      : `update ${tableName}
         set attempts = attempts + 1
         where id = $1
           and verified_at is null`,
    [row.id]
  );

  return exhausted ? ("expired" as const) : ("invalid" as const);
}

async function markRequestVerified(client: any, row: PendingVerificationRow) {
  const tableName = tableNameForKind(row.kind);

  await client.query("begin");
  try {
    await client.query(
      `update ${tableName}
       set verified_at = now()
       where id = $1
         and verified_at is null`,
      [row.id]
    );

    if (row.kind === "verification" && row.account_id) {
      await client.query(
        `update whatsapp_accounts
         set phone_e164 = $1,
             whatsapp_verified = true,
             whatsapp_verified_at = now(),
             updated_at = now()
         where id = $2`,
        [row.phone_e164, row.account_id]
      );
    }

    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  }
}

export async function consumeWhatsappVerificationCode(
  fastify: any,
  input: {
    phoneE164: string;
    code: string;
  }
) {
  const client = await fastify.pg.connect();

  try {
    const code = String(input.code ?? "").trim();
    if (!code) {
      return { handled: false as const };
    }

    const pending = await loadPendingRequests(client, input.phoneE164);
    if (!pending.length) {
      return { handled: false as const };
    }

    const now = Date.now();
    const exactMatch = pending.find((row) => row.code === code) ?? null;

    if (exactMatch) {
      if (exactMatch.expires_at.getTime() <= now) {
        await expirePendingRequest(client, exactMatch);
        return {
          handled: true as const,
          kind: exactMatch.kind,
          status: "expired" as const,
          projectKey: exactMatch.project_key
        };
      }

      await markRequestVerified(client, exactMatch);
      return {
        handled: true as const,
        kind: exactMatch.kind,
        status: "verified" as const,
        projectKey: exactMatch.project_key
      };
    }

    const latestPending = pending[0];
    if (latestPending.expires_at.getTime() <= now) {
      await expirePendingRequest(client, latestPending);
      return {
        handled: true as const,
        kind: latestPending.kind,
        status: "expired" as const,
        projectKey: latestPending.project_key
      };
    }

    const status = await registerInvalidAttempt(client, latestPending);
    return {
      handled: true as const,
      kind: latestPending.kind,
      status,
      projectKey: latestPending.project_key
    };
  } finally {
    client.release();
  }
}
