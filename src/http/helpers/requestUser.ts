import { unauthorized } from "../../errors/HttpError.js";

/**
 * Extracts and validates the authenticated user from `request.user`.
 * Throws 401 if the user is not present or has no uid.
 */
export function requireUser(request: any) {
  const uid = String(request.user?.uid ?? "").trim();
  if (!uid) {
    throw unauthorized();
  }
  return {
    uid,
    email: request.user?.email ? String(request.user.email) : null,
    name: request.user?.name ? String(request.user.name) : null
  };
}
