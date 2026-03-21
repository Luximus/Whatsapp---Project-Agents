export function normalizeProjectKey(value: string) {
  return value.trim().toLowerCase();
}

export function assertProjectKey(value: string) {
  const normalized = normalizeProjectKey(String(value ?? ""));
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
    throw Object.assign(new Error("invalid_project_key"), { statusCode: 400 });
  }
  return normalized;
}

export async function ensureProjectActive(fastify: any, projectKey: string) {
  await fastify.pg.query(
    `insert into whatsapp_projects (project_key, display_name)
     values ($1, $2)
     on conflict (project_key) do nothing`,
    [projectKey, projectKey]
  );

  const { rows } = await fastify.pg.query(
    `select is_active
     from whatsapp_projects
     where project_key = $1
     limit 1`,
    [projectKey]
  );

  const project = rows[0] as { is_active: boolean } | undefined;
  if (!project || !project.is_active) {
    throw Object.assign(new Error("project_not_active"), { statusCode: 403 });
  }
}
