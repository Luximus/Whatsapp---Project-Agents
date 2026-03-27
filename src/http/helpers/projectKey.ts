import { env } from "../../config/env.js";
import { badRequest } from "../../errors/HttpError.js";

function normalizeProjectKey(value: string): string {
  return value.trim().toLowerCase();
}

/**
 * Resolves the project key from (in priority order):
 * 1. Explicit value from body/query
 * 2. `x-project-key` request header
 * 3. `project_key` query string param
 * 4. `env.defaultProject`
 *
 * Throws 400 if the resolved key has an invalid format.
 */
export function resolveProjectKey(request: any, explicitProjectKey?: string): string {
  const headerProject = Array.isArray(request.headers?.["x-project-key"])
    ? request.headers["x-project-key"][0]
    : request.headers?.["x-project-key"];
  const queryProject = (request.query as any)?.project_key;

  const candidate =
    explicitProjectKey ??
    (typeof queryProject === "string" ? queryProject : undefined) ??
    (typeof headerProject === "string" ? headerProject : undefined) ??
    env.defaultProject;

  const normalized = normalizeProjectKey(String(candidate ?? ""));
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(normalized)) {
    throw badRequest("invalid_project_key");
  }
  return normalized;
}
