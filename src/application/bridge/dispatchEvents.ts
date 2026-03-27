import { env } from "../../config/env.js";
import { dispatchDueBridgeEvents } from "./sessionStore.js";
import { badRequest } from "../../errors/HttpError.js";

export async function dispatchBridgeEventsUseCase(input?: {
  projectKey?: string;
  limit?: number;
}) {
  const projectKey = input?.projectKey?.trim().toLowerCase();

  if (projectKey && !/^[a-z0-9][a-z0-9_-]{1,63}$/.test(projectKey)) {
    throw badRequest("invalid_project_key");
  }

  return dispatchDueBridgeEvents(null, {
    projectKey,
    limit: input?.limit ?? env.BRIDGE_EVENT_DISPATCH_LIMIT
  });
}
