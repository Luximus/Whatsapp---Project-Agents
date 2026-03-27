import type { Pool } from "pg";
import { HttpError } from "../../../errors/HttpError.js";

export async function ensureProjectActive(pool: Pool, projectKey: string): Promise<void> {
  await pool.query(
    `insert into whatsapp_projects (project_key, display_name)
     values ($1, $2)
     on conflict (project_key) do nothing`,
    [projectKey, projectKey]
  );

  const { rows } = await pool.query(
    `select is_active
     from whatsapp_projects
     where project_key = $1
     limit 1`,
    [projectKey]
  );

  const project = rows[0] as { is_active: boolean } | undefined;
  if (!project || !project.is_active) {
    throw new HttpError(403, "project_not_active");
  }
}
