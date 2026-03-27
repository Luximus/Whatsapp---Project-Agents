import { timingSafeEqual } from "node:crypto";
import { env } from "../../config/env.js";
import { badRequest, unauthorized, forbidden, notImplemented } from "../../errors/HttpError.js";

function toComparableBuffer(value: string) {
  return Buffer.from(value, "utf8");
}

function safeSecretCompare(left: string, right: string) {
  const a = toComparableBuffer(left);
  const b = toComparableBuffer(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function parseHeaderString(headerValue: unknown) {
  if (Array.isArray(headerValue)) return typeof headerValue[0] === "string" ? headerValue[0] : null;
  return typeof headerValue === "string" ? headerValue : null;
}

function parseBearerToken(authHeader: unknown) {
  const raw = parseHeaderString(authHeader);
  if (!raw) return null;
  const match = raw.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

export function requireBridgeProjectAuth(request: any, expectedProjectKey?: string) {
  const rawProjectKey = parseHeaderString(request.headers?.["x-project-key"]);
  if (!rawProjectKey?.trim()) {
    throw unauthorized("bridge_project_key_missing");
  }
  const projectKey = rawProjectKey.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{1,63}$/.test(projectKey)) {
    throw badRequest("invalid_project_key");
  }

  if (expectedProjectKey && projectKey !== expectedProjectKey.trim().toLowerCase()) {
    throw forbidden("bridge_project_key_mismatch");
  }

  const configured = env.bridgeProjects[projectKey];
  if (!configured) {
    throw forbidden("bridge_project_not_configured");
  }

  const providedApiKey =
    parseHeaderString(request.headers?.["x-project-api-key"]) ??
    parseBearerToken(request.headers?.authorization);
  if (!providedApiKey?.trim()) {
    throw unauthorized("bridge_api_key_missing");
  }
  if (!safeSecretCompare(providedApiKey.trim(), configured.apiKey)) {
    throw unauthorized();
  }

  return {
    projectKey,
    config: configured
  };
}

export function requireDispatchToken(request: any) {
  const configuredToken = env.BRIDGE_DISPATCH_TOKEN.trim();
  if (!configuredToken) {
    throw notImplemented("bridge_dispatch_not_configured");
  }

  const providedToken =
    parseHeaderString(request.headers?.["x-bridge-dispatch-token"]) ??
    parseBearerToken(request.headers?.authorization);
  if (!providedToken?.trim()) {
    throw unauthorized("bridge_dispatch_token_missing");
  }
  if (!safeSecretCompare(providedToken.trim(), configuredToken)) {
    throw unauthorized();
  }
}
