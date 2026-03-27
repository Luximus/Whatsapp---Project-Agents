import type { Pool } from "pg";

export type AgentContactRow = {
  id: number;
  project_key: string;
  phone_e164: string;
  first_name: string | null;
  last_name: string | null;
  company: string | null;
  email: string | null;
  need: string | null;
};

export async function findAgentContact(
  pool: Pool,
  projectKey: string,
  phoneE164: string
): Promise<AgentContactRow | null> {
  const { rows } = await pool.query(
    `select id, project_key, phone_e164, first_name, last_name, company, email, need
     from agent_contacts
     where project_key = $1 and phone_e164 = $2
     limit 1`,
    [projectKey, phoneE164]
  );
  return (rows[0] as AgentContactRow | undefined) ?? null;
}

export async function upsertAgentContact(
  pool: Pool,
  input: {
    projectKey: string;
    phoneE164: string;
    firstName: string | null;
    lastName: string | null;
    company: string | null;
    email: string | null;
    need: string | null;
  }
): Promise<void> {
  await pool.query(
    `insert into agent_contacts (project_key, phone_e164, first_name, last_name, company, email, need)
     values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (project_key, phone_e164) do update set
       first_name = coalesce(excluded.first_name, agent_contacts.first_name),
       last_name  = coalesce(excluded.last_name,  agent_contacts.last_name),
       company    = coalesce(excluded.company,    agent_contacts.company),
       email      = coalesce(excluded.email,      agent_contacts.email),
       need       = coalesce(excluded.need,       agent_contacts.need),
       updated_at = now()`,
    [
      input.projectKey,
      input.phoneE164,
      input.firstName,
      input.lastName,
      input.company,
      input.email,
      input.need
    ]
  );
}
