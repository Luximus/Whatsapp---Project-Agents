import { extractOtp } from "../../domain/whatsapp/otpExtractor.js";
import { consumeBridgeOtp, dispatchDueBridgeEvents } from "../bridge/sessionStore.js";
import { trackOtpMessage } from "../../domain/reporting/tracker.js";
import type { LogFn } from "./handleInbound.js";
import { safeReply } from "./handleInbound.js";

export type OtpHandleResult =
  | { handled: false }
  | { handled: true };

/**
 * Checks if the incoming message contains an OTP code.
 * If so, consumes it against the bridge session store, sends the
 * appropriate reply, and dispatches any due bridge events.
 *
 * Returns `{ handled: true }` when the message was an OTP attempt
 * (regardless of whether verification succeeded), so the caller can
 * skip regular agent processing.
 */
export async function handleOtpMessage(
  input: {
    from: string;
    text: string;
    incomingMessageId: string | null;
  },
  log: { warn: LogFn }
): Promise<OtpHandleResult> {
  const otp = extractOtp(input.text);
  if (!otp) return { handled: false };

  trackOtpMessage();

  // _fastify param is unused inside consumeBridgeOtp / dispatchDueBridgeEvents
  const result = await consumeBridgeOtp(null, {
    from: input.from,
    otp,
    text: input.text
  });

  if (!result.handled) return { handled: false };

  if (result.status === "verified") {
    await safeReply(
      input.from,
      "Codigo verificado. Vuelve a la app para continuar.",
      input.incomingMessageId,
      log
    );
    await dispatchDueBridgeEvents(null, {
      projectKey: result.session.project_key,
      limit: 20
    });
  } else {
    await safeReply(
      input.from,
      "Codigo invalido o expirado. Genera uno nuevo en la app.",
      input.incomingMessageId,
      log
    );
  }

  return { handled: true };
}
