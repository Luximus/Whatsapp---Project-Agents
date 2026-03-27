import type { Pool } from "pg";

export async function insertAgentMessage(
  pool: Pool,
  input: {
    projectKey: string;
    phoneE164: string;
    role: "user" | "assistant";
    body: string;
  }
): Promise<void> {
  await pool.query(
    `insert into agent_messages (project_key, phone_e164, role, body)
     values ($1, $2, $3, $4)`,
    [input.projectKey, input.phoneE164, input.role, input.body]
  );
}

export async function getRecentAgentMessages(
  pool: Pool,
  projectKey: string,
  phoneE164: string,
  limit = 20
): Promise<Array<{ role: "user" | "assistant"; body: string; created_at: Date }>> {
  const { rows } = await pool.query(
    `select role, body, created_at
     from agent_messages
     where project_key = $1 and phone_e164 = $2
     order by created_at desc
     limit $3`,
    [projectKey, phoneE164, limit]
  );
  return (rows as any[]).reverse() as Array<{ role: "user" | "assistant"; body: string; created_at: Date }>;
}
