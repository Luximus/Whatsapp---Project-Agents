import { env } from "../../config/env.js";
import { MAX_TEXT_REPLY_CHARS } from "../../config/constants.js";
import { handleProjectAgentMessage } from "../agent/handleAgentMessage.js";
import {
  isElevenLabsConfigured,
  synthesizeSpeechWithElevenLabs
} from "../../infrastructure/ai/elevenlabs.js";
import {
  sendWhatsappText,
  sendWhatsappAudio
} from "../../infrastructure/messaging/whatsappApi.js";
import {
  trackAgentReplyGenerated,
  trackOutboundMessage,
  trackOperationalError
} from "../../domain/reporting/tracker.js";

export type PendingInbound = {
  chunks: string[];
  lastIncomingMessageId: string | null;
  timer: NodeJS.Timeout | null;
};

export type InboundBuffer = Map<string, PendingInbound>;
export type LogFn = (context: unknown, msg: string) => void;

function clampProbability(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

export function shouldApplyProbability(probabilityPercent: number): boolean {
  const probability = clampProbability(probabilityPercent);
  if (probability <= 0) return false;
  if (probability >= 100) return true;
  return Math.random() * 100 < probability;
}

function toTextChannelReply(input: string, maxChars = MAX_TEXT_REPLY_CHARS): string {
  const normalized = String(input ?? "").replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) return normalized;
  if (maxChars <= 3) return normalized.slice(0, maxChars);
  return `${normalized.slice(0, maxChars - 3).trimEnd()}...`;
}

export async function safeReply(
  phoneE164: string,
  message: string,
  replyToMessageId: string | null | undefined,
  log: { warn: LogFn }
): Promise<boolean> {
  try {
    const contextualReplyId =
      replyToMessageId && shouldApplyProbability(env.whatsappReplyContextProbability)
        ? replyToMessageId
        : null;
    await sendWhatsappText(phoneE164, message, { replyToMessageId: contextualReplyId });
    trackOutboundMessage({ messageType: "text" });
    return true;
  } catch (err) {
    trackOperationalError();
    log.warn({ err, to: phoneE164 }, "WhatsApp reply failed");
    return false;
  }
}

export async function safeAudioReply(
  phoneE164: string,
  input: { data: Buffer; mimeType: string; filename: string },
  replyToMessageId: string | null | undefined,
  asVoiceMessage: boolean,
  log: { warn: LogFn }
): Promise<boolean> {
  try {
    const contextualReplyId =
      replyToMessageId && shouldApplyProbability(env.whatsappReplyContextProbability)
        ? replyToMessageId
        : null;
    await sendWhatsappAudio(phoneE164, input, {
      replyToMessageId: contextualReplyId,
      asVoiceMessage
    });
    trackOutboundMessage({ messageType: "audio" });
    return true;
  } catch (err) {
    trackOperationalError();
    log.warn({ err, to: phoneE164 }, "WhatsApp audio reply failed");
    return false;
  }
}

export async function processBufferedInbound(
  phoneE164: string,
  text: string,
  incomingMessageId: string | null,
  log: { warn: LogFn; info: LogFn; error: LogFn }
): Promise<void> {
  const agentReply = await handleProjectAgentMessage({ phoneE164, text });
  const replyText = String(agentReply.reply ?? "").trim();
  if (!agentReply.handled || !replyText) return;

  trackAgentReplyGenerated();

  const isLongReply = replyText.length > MAX_TEXT_REPLY_CHARS;
  const shouldSendAudio = isLongReply && env.whatsappAudioReplyEnabled && isElevenLabsConfigured();

  if (shouldSendAudio) {
    try {
      const generatedAudio = await synthesizeSpeechWithElevenLabs(replyText);
      const isVoiceCompatible =
        generatedAudio.mimeType === "audio/ogg" ||
        generatedAudio.filename.toLowerCase().endsWith(".ogg");
      const useVoiceNote =
        isVoiceCompatible && shouldApplyProbability(env.whatsappAudioVoiceNoteProbability);

      const audioSent = await safeAudioReply(
        phoneE164,
        { data: generatedAudio.data, mimeType: generatedAudio.mimeType, filename: generatedAudio.filename },
        incomingMessageId,
        useVoiceNote,
        log
      );

      if (!isVoiceCompatible) {
        log.info(
          { from: phoneE164, outputFormat: env.elevenlabsOutputFormat },
          "Audio reply sent as regular audio. Configure ELEVENLABS_OUTPUT_FORMAT=opus_48000_64 for WhatsApp voice-note style."
        );
      }

      if (audioSent) return;
    } catch (err) {
      trackOperationalError();
      log.warn({ err, from: phoneE164, incomingMessageId }, "ElevenLabs audio generation failed");
    }
  }

  const textReply = toTextChannelReply(replyText);
  await safeReply(phoneE164, textReply, incomingMessageId, log);
}

export function enqueueInbound(
  buffer: InboundBuffer,
  input: { phoneE164: string; text: string; incomingMessageId: string | null },
  debounceMs: number,
  onFlush: (phoneE164: string, pending: PendingInbound) => void
): void {
  const existing = buffer.get(input.phoneE164);
  const pending: PendingInbound = existing ?? {
    chunks: [],
    lastIncomingMessageId: null,
    timer: null
  };

  pending.chunks.push(input.text);
  if (input.incomingMessageId) {
    pending.lastIncomingMessageId = input.incomingMessageId;
  }
  if (pending.timer) clearTimeout(pending.timer);

  pending.timer = setTimeout(() => {
    buffer.delete(input.phoneE164);
    onFlush(input.phoneE164, pending);
  }, debounceMs);

  buffer.set(input.phoneE164, pending);
}

export function drainBuffer(buffer: InboundBuffer): void {
  for (const pending of buffer.values()) {
    if (pending.timer) clearTimeout(pending.timer);
  }
  buffer.clear();
}
