import { verifyBridgeSessionCode, dispatchDueBridgeEvents } from "./sessionStore.js";

export async function verifyBridgeSessionUseCase(input: {
  projectKey: string;
  sessionId: string;
  code: string;
}) {
  const result = await verifyBridgeSessionCode(null, {
    projectKey: input.projectKey,
    sessionId: input.sessionId,
    code: input.code
  });

  if (!result.found) {
    return { found: false as const };
  }

  await dispatchDueBridgeEvents(null, { projectKey: input.projectKey, limit: 10 });

  return {
    found: true as const,
    status: result.status,
    session: result.session
  };
}
