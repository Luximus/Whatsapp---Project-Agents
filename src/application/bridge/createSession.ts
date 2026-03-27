import { z } from "zod";
import { BRIDGE_FLOWS } from "../../domain/bridge/types.js";
import { badRequest } from "../../errors/HttpError.js";
import { createBridgeSession } from "./sessionStore.js";
import { buildBridgeMessage, resolveBridgeSessionStatus } from "../../domain/bridge/otp.js";
import { sendWhatsappText } from "../../infrastructure/messaging/whatsappApi.js";
import { normalizeE164 } from "../../domain/whatsapp/otpExtractor.js";
import type { LogFn } from "../whatsapp/handleInbound.js";

export const createSessionBodySchema = z.object({
  flow: z.enum(BRIDGE_FLOWS).optional().default("verification"),
  phone_e164: z.string().min(1).max(40),
  user_code: z.string().regex(/^\d{6}$/).optional(),
  user_ref: z.string().min(1).max(128).optional(),
  correlation_id: z.string().min(1).max(128).optional(),
  metadata: z.record(z.string(), z.unknown()).optional()
});

export type CreateSessionBody = z.infer<typeof createSessionBodySchema>;

export function requireE164(value: string): string {
  const normalized = normalizeE164(value);
  if (!normalized || !/^\+\d{8,16}$/.test(normalized)) {
    throw badRequest("whatsapp_invalid_phone");
  }
  return normalized;
}

export async function createBridgeSessionUseCase(
  input: {
    projectKey: string;
    callbackUrl: string | null;
    body: CreateSessionBody;
  },
  log: { warn: LogFn }
) {
  const phoneE164 = requireE164(input.body.phone_e164);

  const session = await createBridgeSession(null, {
    projectKey: input.projectKey,
    flow: input.body.flow,
    phoneE164,
    userCode: input.body.user_code,
    userRef: input.body.user_ref,
    correlationId: input.body.correlation_id,
    metadata: input.body.metadata ?? null,
    callbackUrl: input.callbackUrl
  });

  const message = buildBridgeMessage(session.flow, session.code, session.otp_ref);

  let deliveryOk = false;
  let waMessageId: string | null = null;
  let deliveryError: { message: string; status_code: number | null; details: unknown } | null = null;

  try {
    const waSendResult = await sendWhatsappText(phoneE164, message);
    waMessageId =
      waSendResult &&
      typeof waSendResult === "object" &&
      Array.isArray((waSendResult as any).messages) &&
      (waSendResult as any).messages[0] &&
      typeof (waSendResult as any).messages[0].id === "string"
        ? String((waSendResult as any).messages[0].id)
        : null;
    deliveryOk = true;
  } catch (err: any) {
    deliveryError = {
      message: String(err?.message ?? "whatsapp_send_failed"),
      status_code: typeof err?.statusCode === "number" ? err.statusCode : null,
      details: err?.details ?? null
    };
    log.warn(
      { projectKey: input.projectKey, phoneE164, deliveryError },
      "Bridge WhatsApp delivery failed"
    );
  }

  return {
    session,
    status: resolveBridgeSessionStatus(session),
    deliveryMode: "cloud_api" as const,
    instructions: deliveryOk
      ? "Codigo enviado a WhatsApp del usuario."
      : "No fue posible entregar el codigo por WhatsApp.",
    waMessageId,
    deliveryOk,
    deliveryError
  };
}
