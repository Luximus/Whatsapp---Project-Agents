import type { FastifyPluginAsync } from "fastify";
import { consumeBridgeOtp, dispatchDueBridgeEvents } from "../lib/bridge.js";
import { env } from "../env.js";
import { verifyWhatsappSignature } from "../lib/whatsappSignature.js";
import { transcribeAudio, synthesizeSpeech, isSpeechConfigured } from "../lib/ai/index.js";
import { handleAgentMessage } from "../lib/agents/index.js";
import type { AgentActions } from "../lib/agents/index.js";
import {
  loadConversationHistory,
  recordConversationTurn
} from "../lib/agents/conversation/index.js";
import { t, detectLocale } from "../i18n/index.js";
import type { Locale } from "../i18n/index.js";
import { consumeWhatsappVerificationCode } from "../lib/whatsappVerification.js";
import {
  startLink,
  confirmLink,
  listLinkedAccounts,
  getAccountInfo,
  callServiceApi,
  connectServer,
  assistantSend,
  assistantPoll,
  switchConnection,
  listServers,
  setSshEnabled,
  disconnectServer,
  awaitCompletion,
  unlinkAccount,
  confirmPendingLink,
  authenticate
} from "../lib/services/index.js";
import {
  sendMeetingQuoteEmail,
  sendSupportTicketEmail,
  trackInboundMessage,
  trackMeetingScheduled,
  trackOpenAIFailure,
  trackOperationalError,
  trackOtpMessage,
  trackOutboundMessage,
  trackSupportTicketCreated
} from "../lib/reporting.js";
import {
  downloadWhatsappMedia,
  extractOtp,
  markWhatsappMessageAsRead,
  normalizeE164,
  sendWhatsappAudio,
  sendWhatsappText,
  sendWhatsappTypingIndicator
} from "../lib/whatsapp.js";

type WebhookMessage = {
  id?: string;
  from?: string;
  type?: string;
  text?: { body?: string };
  reaction?: {
    emoji?: string;
    message_id?: string;
  };
  audio?: {
    id?: string;
    mime_type?: string;
    voice?: boolean;
  };
};

type WebhookStatus = {
  id?: string;
  status?: string;
  recipient_id?: string;
  errors?: Array<{ code?: number; title?: string; message?: string }>;
};

function clampProbability(value: number) {
  if (!Number.isFinite(value)) return 0;
  if (value <= 0) return 0;
  if (value >= 100) return 100;
  return value;
}

function shouldApplyProbability(probabilityPercent: number) {
  const probability = clampProbability(probabilityPercent);
  if (probability <= 0) return false;
  if (probability >= 100) return true;
  return Math.random() * 100 < probability;
}

type AgentReplyMode = "text" | "audio" | "quoted";

// Elige el modo de respuesta del asistente IA por probabilidad ponderada
// (texto / nota de voz / texto citado). El peso de audio solo se anula si el
// proveedor TTS no está configurado (no se puede generar voz); su peso se
// reparte entonces entre texto y citado.
function pickAgentReplyMode(): AgentReplyMode {
  const canAudio = isSpeechConfigured();
  const audioWeight = canAudio ? Math.max(0, env.whatsappReplyAudioProbability) : 0;
  const quotedWeight = Math.max(0, env.whatsappReplyQuotedProbability);
  const textWeight = Math.max(0, env.whatsappReplyTextProbability);
  const total = audioWeight + quotedWeight + textWeight;
  if (total <= 0) return "text";

  let roll = Math.random() * total;
  if ((roll -= audioWeight) < 0) return "audio";
  if ((roll -= quotedWeight) < 0) return "quoted";
  return "text";
}

function flattenWebhookMessages(body: any) {
  const messages: WebhookMessage[] = [];
  const statuses: WebhookStatus[] = [];

  const entries = Array.isArray(body?.entry) ? body.entry : [];
  for (const entry of entries) {
    const changes = Array.isArray(entry?.changes) ? entry.changes : [];
    for (const change of changes) {
      const value = change?.value ?? {};
      const batchMessages = Array.isArray(value?.messages) ? value.messages : [];
      const batchStatuses = Array.isArray(value?.statuses) ? value.statuses : [];
      messages.push(...batchMessages);
      statuses.push(...batchStatuses);
    }
  }

  return { messages, statuses };
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  // Conservamos el cuerpo crudo SOLO en este contexto encapsulado (las rutas
  // del webhook) para poder verificar la firma HMAC de Meta sobre los bytes
  // exactos. El resto de rutas de la app siguen usando el parser JSON normal.
  fastify.addContentTypeParser("application/json", { parseAs: "buffer" }, (request, body, done) => {
    (request as any).rawBody = body as Buffer;
    try {
      const parsed = (body as Buffer).length ? JSON.parse((body as Buffer).toString("utf8")) : {};
      done(null, parsed);
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  const safeReply = async (
    to: string,
    message: string,
    replyToMessageId?: string | null,
    options?: { quote?: boolean }
  ) => {
    try {
      // Si el llamador fija `quote` (respuestas del agente, modo determinista),
      // se respeta; si no, se mantiene el comportamiento probabilístico clásico
      // para OTP/verificación.
      const useQuote =
        typeof options?.quote === "boolean"
          ? options.quote
          : Boolean(replyToMessageId) && shouldApplyProbability(env.whatsappReplyContextProbability);
      const contextualReplyId = useQuote ? (replyToMessageId ?? null) : null;
      await sendWhatsappText(to, message, {
        replyToMessageId: contextualReplyId
      });
      trackOutboundMessage({ messageType: "text" });
      return true;
    } catch (err) {
      trackOperationalError();
      fastify.log.warn(
        { err, to, replyToMessageId: replyToMessageId ?? null },
        "WhatsApp reply failed"
      );
      return false;
    }
  };

  // Intenta responder con NOTA DE VOZ sintetizando el texto. Devuelve true si se
  // envió; ante cualquier fallo devuelve false para que el llamador caiga a
  // texto (nunca dejamos al usuario sin respuesta por un fallo de TTS).
  const tryReplyWithVoice = async (to: string, message: string): Promise<boolean> => {
    try {
      const audio = await synthesizeSpeech({ text: message });
      // WhatsApp solo trata OGG/Opus como nota de voz real; el resto va como
      // audio normal reproducible.
      const asVoiceMessage = audio.mimeType === "audio/ogg";
      await sendWhatsappAudio(
        to,
        { data: audio.data, mimeType: audio.mimeType, filename: `reply.${audio.extension}` },
        { asVoiceMessage }
      );
      trackOutboundMessage({ messageType: "audio" });
      return true;
    } catch (err) {
      trackOperationalError();
      fastify.log.warn({ err, to }, "WhatsApp voice reply failed; falling back to text");
      return false;
    }
  };

  const markReadAndShowTyping = async (phoneE164: string, incomingMessageId: string | null) => {
    if (!incomingMessageId) return;

    if (shouldApplyProbability(env.whatsappMarkAsReadProbability)) {
      try {
        await markWhatsappMessageAsRead(incomingMessageId);
      } catch (err) {
        trackOperationalError();
        fastify.log.warn(
          { err, incomingMessageId, from: phoneE164 },
          "WhatsApp mark-as-read failed"
        );
      }
    }

    if (shouldApplyProbability(env.whatsappTypingIndicatorProbability)) {
      try {
        await sendWhatsappTypingIndicator(incomingMessageId);
      } catch (err) {
        trackOperationalError();
        fastify.log.warn(
          { err, incomingMessageId, from: phoneE164 },
          "WhatsApp typing indicator failed"
        );
      }
    }
  };

  fastify.get("/api/webhooks/whatsapp", async (request, reply) => {
    const mode = (request.query as any)?.["hub.mode"];
    const token = (request.query as any)?.["hub.verify_token"];
    const challenge = (request.query as any)?.["hub.challenge"];

    if (mode === "subscribe" && token === env.WHATSAPP_WEBHOOK_VERIFY_TOKEN) {
      reply.code(200).send(challenge ?? "");
      return;
    }

    reply.code(403).send("Invalid token");
  });

  fastify.post("/api/webhooks/whatsapp", async (request, reply) => {
    if (env.WHATSAPP_APP_SECRET) {
      const valid = verifyWhatsappSignature({
        appSecret: env.WHATSAPP_APP_SECRET,
        rawBody: (request as any).rawBody ?? Buffer.alloc(0),
        signatureHeader: request.headers["x-hub-signature-256"] as string | undefined
      });
      if (!valid) {
        fastify.log.warn({ url: request.url }, "WhatsApp webhook signature verification failed");
        reply.code(401);
        return { error: "invalid_signature" };
      }
    } else {
      fastify.log.warn(
        "WHATSAPP_APP_SECRET not set: skipping webhook signature verification (insecure)"
      );
    }

    const body = request.body as any;
    const { messages, statuses } = flattenWebhookMessages(body);

    for (const status of statuses) {
      if (status.status === "failed") {
        fastify.log.warn(
          {
            waMessageId: status.id ?? null,
            waStatus: status.status ?? null,
            recipientId: status.recipient_id ?? null,
            errors: status.errors ?? []
          },
          "WhatsApp delivery failed"
        );
      } else {
        fastify.log.info(
          {
            waMessageId: status.id ?? null,
            waStatus: status.status ?? null,
            recipientId: status.recipient_id ?? null
          },
          "WhatsApp delivery status"
        );
      }
    }

    if (!messages.length) return { ok: true };

    for (const msg of messages) {
      const incomingMessageId = String(msg.id ?? "").trim();
      const from = msg.from ? normalizeE164(msg.from) : null;
      const messageType = String(msg.type ?? "")
        .trim()
        .toLowerCase();
      if (!from) continue;

      const isReaction =
        messageType === "reaction" || Boolean(String(msg.reaction?.emoji ?? "").trim());
      if (isReaction) {
        fastify.log.info(
          {
            from,
            incomingMessageId: incomingMessageId || null,
            reactionToMessageId: String(msg.reaction?.message_id ?? "").trim() || null,
            reactionEmoji: String(msg.reaction?.emoji ?? "").trim() || null
          },
          "Ignoring WhatsApp reaction event"
        );
        continue;
      }

      await markReadAndShowTyping(from, incomingMessageId || null);

      let text = String(msg.text?.body ?? "").trim();
      // Idioma inicial inferido del texto entrante; se reevalúa tras transcribir.
      let locale = detectLocale(text);
      const isAudioInput = messageType === "audio" || (!!msg.audio?.id && !text);
      trackInboundMessage({
        fromE164: from,
        messageType: isAudioInput ? "audio" : "text"
      });

      if (isAudioInput && msg.audio?.id) {
        try {
          const media = await downloadWhatsappMedia(msg.audio.id);
          text = await transcribeAudio({
            data: media.data,
            mimeType: media.mimeType,
            filename: media.filename
          });
          text = text.trim();
          locale = detectLocale(text);
        } catch (err) {
          fastify.log.warn(
            { err, from, incomingMessageId, mediaId: msg.audio.id ?? null },
            "Audio transcription failed"
          );
          trackOpenAIFailure();
          trackOperationalError();
          await safeReply(from, t("audio_transcription_failed", locale), incomingMessageId);
          continue;
        }
      }

      if (!text) continue;

      const otp = extractOtp(text);
      if (otp) {
        trackOtpMessage();
        const bridgeResult = await consumeBridgeOtp(fastify, {
          from,
          otp,
          text
        });

        if (bridgeResult.handled) {
          if (bridgeResult.status === "verified") {
            await safeReply(from, t("code_verified", locale), incomingMessageId);
            await dispatchDueBridgeEvents(fastify, {
              projectKey: bridgeResult.session.project_key,
              limit: 20
            });
          } else {
            await safeReply(from, t("code_invalid_or_expired", locale), incomingMessageId);
          }
          continue;
        }

        // Verificación de cuenta (login/registro/recuperación). Si la tabla
        // falla (p.ej. permisos), NO debe tumbar el webhook: degradamos a
        // "no manejado" para seguir con el vínculo o el agente.
        let verificationResult: { handled: boolean; status?: string } = { handled: false };
        try {
          verificationResult = await consumeWhatsappVerificationCode(fastify, {
            phoneE164: from,
            code: otp
          });
        } catch (err) {
          fastify.log.warn({ err, from }, "whatsapp verification consume failed; degrading");
        }
        if (verificationResult.handled) {
          await safeReply(
            from,
            verificationResult.status === "verified"
              ? t("code_verified", locale)
              : t("code_invalid_or_expired", locale),
            incomingMessageId
          );
          continue;
        }

        // Vínculo de servicio: si hay un OTP de vínculo pendiente para este
        // número, confirmarlo de forma determinista (sin depender del agente).
        if (env.whatsappServicesEnabled) {
          const linkResult = await confirmPendingLink(fastify, { phoneE164: from, code: otp });
          if (linkResult.status === "linked") {
            await safeReply(
              from,
              t("link_confirmed", locale).replace("{service}", linkResult.serviceName),
              incomingMessageId
            );
            // Retoma la última solicitud (p.ej. "conéctate a mi servidor") sin
            // que el usuario tenga que repetirla: el agente tiene el historial.
            await tryAgentReply(from, t("auth_retry_seed", locale), incomingMessageId || null, locale);
            continue;
          }
          if (linkResult.status === "invalid" || linkResult.status === "expired") {
            await safeReply(from, t("link_code_invalid", locale), incomingMessageId);
            continue;
          }
          // No había vínculo pendiente: quizá es una RE-AUTENTICACIÓN 2FA de una
          // cuenta ya vinculada (sesión expirada). Intentar autenticar.
          const authRes = await authenticate(fastify, { phoneE164: from, code: otp });
          if (authRes.status === "authenticated") {
            await safeReply(from, t("auth_ok", locale), incomingMessageId);
            // Retoma automáticamente lo que el usuario pidió antes del 2FA.
            await tryAgentReply(from, t("auth_retry_seed", locale), incomingMessageId || null, locale);
            continue;
          }
          if (authRes.status === "invalid") {
            await safeReply(from, t("link_code_invalid", locale), incomingMessageId);
            continue;
          }
          // "not_linked"/"error": no aplica → sigue el curso normal.
        }

        // Ni verificación ni vínculo: que el agente intente interpretarlo
        // (puede ser un número que el usuario escribió por otro motivo).
        if (env.whatsappAgentEnabled) {
          const replied = await tryAgentReply(from, text, incomingMessageId || null, locale);
          if (replied) continue;
        }

        await safeReply(from, t("code_invalid_or_expired", locale), incomingMessageId);
        continue;
      }

      // Mensaje sin código OTP. Si el asistente está habilitado, lo enrutamos
      // al runtime multi-agente; si falla o está desactivado, caemos al
      // mensaje de ayuda de verificación (comportamiento histórico).
      if (env.whatsappAgentEnabled) {
        const replied = await tryAgentReply(from, text, incomingMessageId || null, locale);
        if (replied) continue;
      }

      await safeReply(from, t("verification_help", locale), incomingMessageId || null);
    }

    return { ok: true };
  });

  async function tryAgentReply(
    to: string,
    userMessage: string,
    replyToMessageId: string | null,
    locale: Locale
  ): Promise<boolean> {
    try {
      const history = await loadConversationHistory(fastify, {
        projectKey: env.defaultProject,
        phoneE164: to
      });
      const result = await handleAgentMessage({
        projectKey: env.defaultProject,
        userMessage,
        history,
        context: { from: to, logger: fastify.log, actions: buildAgentActions(to, locale) }
      });
      const reply = result.text?.trim();
      if (!reply) return false;
      // El asistente IA elige modo por probabilidad: nota de voz / texto plano /
      // texto citando al usuario. Si la voz falla o no aplica, cae a texto plano.
      const mode = pickAgentReplyMode();
      let sent = false;
      if (mode === "audio") {
        sent = await tryReplyWithVoice(to, reply);
      }
      if (!sent) {
        sent = await safeReply(to, reply, replyToMessageId, { quote: mode === "quoted" });
      }
      if (sent) {
        // Persistimos el turno para que el siguiente mensaje tenga contexto.
        await recordConversationTurn(fastify, {
          projectKey: env.defaultProject,
          phoneE164: to,
          userMessage,
          assistantMessage: reply
        });
      }
      return sent;
    } catch (err) {
      trackOperationalError();
      fastify.log.warn({ err, to }, "Agent reply failed; falling back to verification help");
      return false;
    }
  }

  // Acciones de negocio que se inyectan en el contexto de las tools del agente.
  // La lógica vive aquí (capa de rutas), no en el runtime ni en el script.
  function buildAgentActions(phoneE164: string, locale: Locale): AgentActions {
    const actions: AgentActions = {
      async scheduleMeeting(input: {
        contactName: string;
        company?: string;
        contactEmail?: string;
        meetingDay?: string;
        meetingDate?: string;
        meetingTime?: string | null;
        service?: string;
        reason?: string;
      }) {
        const record = {
          projectKey: env.defaultProject,
          userPhone: phoneE164,
          contactName: input.contactName || "",
          contactEmail: input.contactEmail || "",
          company: input.company || "",
          meetingDay: input.meetingDay || "",
          meetingDate: input.meetingDate || "",
          meetingTime: input.meetingTime ?? null,
          reason: input.reason || input.service || "",
          notifiedHuman: false
        };
        const res = await sendMeetingQuoteEmail(record);
        if (res.sent) {
          trackMeetingScheduled(record);
        } else {
          fastify.log.warn(
            { to: phoneE164, error: res.error },
            "scheduleMeeting: meeting quote email not sent"
          );
        }
        return { ok: res.sent, message: res.error };
      },

      async escalateToHuman(input: {
        contactName?: string;
        company?: string;
        contactEmail?: string;
        topic?: string;
        summary: string;
      }) {
        // La transferencia a un humano se notifica por CORREO, nunca por WhatsApp
        // (la Cloud API no permite escribir a quien no inició la conversación).
        const res = await sendSupportTicketEmail({
          projectKey: env.defaultProject,
          userPhone: phoneE164,
          contactName: input.contactName || "",
          contactEmail: input.contactEmail || "",
          company: input.company || "",
          topic: input.topic || "transferencia a humano",
          summary: input.summary || ""
        });
        if (res.sent) {
          trackSupportTicketCreated();
        } else {
          fastify.log.warn(
            { to: phoneE164, error: res.error },
            "escalateToHuman: support ticket email not sent"
          );
        }
        return { ok: res.sent, message: res.error };
      }
    };

    // Capa de servicios (opt-in). Si está apagada, las tools de vínculo/cuenta
    // no reciben implementación y degradan con gracia ("no disponible").
    if (env.whatsappServicesEnabled) {
      // 2FA obligatorio: startLink ya NO envía código; el usuario confirma con
      // el código de su app autenticadora (TOTP). Solo devolvemos el estado.
      actions.startLink = async (input) => startLink(fastify, { phoneE164, serviceId: input.service });

      actions.confirmLink = async (input) =>
        confirmLink(fastify, { phoneE164, serviceId: input.service, code: input.code });

      actions.authenticate = async (input) =>
        authenticate(fastify, { phoneE164, service: input.service, code: input.code });

      actions.listLinks = async () => ({
        accounts: await listLinkedAccounts(fastify, phoneE164)
      });

      actions.getAccountInfo = async (input) =>
        getAccountInfo(fastify, { phoneE164, serviceId: input.service });

      actions.unlinkAccount = async (input) =>
        unlinkAccount(fastify, { phoneE164, serviceId: input.service });

      actions.callServiceApi = async (input) =>
        callServiceApi(fastify, {
          phoneE164,
          serviceId: input.service,
          action: input.action,
          params: input.params
        });

      // Operar un servidor por el asistente de LUXIPANEL (Fase 2).
      actions.listServers = async () => listServers(fastify, { phoneE164 });
      actions.setSshEnabled = async (input) =>
        setSshEnabled(fastify, { phoneE164, targetId: input.targetId, enabled: input.enabled });
      actions.connectServer = async (input) =>
        connectServer(fastify, { phoneE164, targetId: input.targetId });
      actions.assistantSend = async (input) => {
        const r = await assistantSend(fastify, { phoneE164, text: input.text });
        // Si el run sigue en curso tras la espera inline, vigílalo en segundo
        // plano y empuja el resultado por WhatsApp cuando termine (efecto en la
        // capa de rutas, no en el servicio). El usuario inició la conversación,
        // así que podemos escribirle (ventana de 24h de la Cloud API).
        if (r.status === "working") {
          void awaitCompletion(fastify, { phoneE164 })
            .then((text) => {
              if (text) void safeReply(phoneE164, text, null);
            })
            .catch(() => {});
        }
        return r;
      };
      actions.assistantPoll = async () => assistantPoll(fastify, { phoneE164 });
      actions.switchConnection = async (input) =>
        switchConnection(fastify, { phoneE164, targetId: input.targetId });
      actions.disconnectServer = async () => disconnectServer(fastify, { phoneE164 });
    }

    return actions;
  }
};
