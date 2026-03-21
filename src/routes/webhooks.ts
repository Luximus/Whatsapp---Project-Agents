import type { FastifyPluginAsync } from "fastify";
import { consumeBridgeOtp, dispatchDueBridgeEvents } from "../lib/bridge.js";
import { env } from "../env.js";
import { extractOtp, normalizeE164, sendWhatsappText } from "../lib/whatsapp.js";

type WebhookMessage = {
  id?: string;
  from?: string;
  text?: { body?: string };
};

type PendingCodeRow = {
  id: number;
  project_key: string;
  code: string;
  expires_at: Date;
  firebase_uid?: string;
};

async function updateAttempts(fastify: any, table: string, id: number) {
  await fastify.pg.query(
    `update ${table}
     set attempts = attempts + 1,
         updated_at = now()
     where id = $1`,
    [id]
  );
}

async function markVerified(fastify: any, table: string, id: number) {
  await fastify.pg.query(
    `update ${table}
     set verified_at = now(),
         updated_at = now()
     where id = $1`,
    [id]
  );
}

export const webhookRoutes: FastifyPluginAsync = async (fastify) => {
  const safeReply = async (to: string, message: string) => {
    try {
      await sendWhatsappText(to, message);
    } catch (err) {
      fastify.log.warn({ err }, "WhatsApp reply failed");
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

  fastify.post("/api/webhooks/whatsapp", async (request) => {
    const body = request.body as any;
    const messages: WebhookMessage[] = body?.entry?.[0]?.changes?.[0]?.value?.messages ?? [];
    if (!messages.length) return { ok: true };

    const msg = messages[0];
    const from = msg.from ? normalizeE164(msg.from) : null;
    const text = msg.text?.body ?? "";
    const otp = extractOtp(text);

    await fastify.pg.query(
      `insert into whatsapp_incoming_messages (wa_message_id, from_e164, body, extracted_code)
       values ($1, $2, $3, $4)`,
      [msg.id ?? null, from, text || null, otp]
    );

    if (!from || !otp) {
      return { ok: true };
    }

    const invalidMsg = "Codigo invalido o expirado. Genera uno nuevo en la app.";
    const bridgeResult = await consumeBridgeOtp(fastify, {
      from,
      otp,
      text
    });
    if (bridgeResult.handled) {
      if (bridgeResult.status === "verified") {
        await safeReply(from, "Codigo verificado. Vuelve a la app para continuar.");
        await dispatchDueBridgeEvents(fastify, {
          projectKey: bridgeResult.session.project_key,
          limit: 20
        });
      } else {
        await safeReply(from, invalidMsg);
      }
      return { ok: true };
    }

    const verifiedChecks: Array<{ table: string; label: string }> = [
      { table: "whatsapp_verification_requests", label: "Verificacion" },
      { table: "whatsapp_login_requests", label: "Login" },
      { table: "whatsapp_register_requests", label: "Registro" },
      { table: "whatsapp_recovery_requests", label: "Recuperacion" }
    ];

    for (const check of verifiedChecks) {
      const { rows } = await fastify.pg.query(
        `select verified_at
         from ${check.table}
         where phone_e164 = $1 and code = $2 and verified_at is not null
         order by verified_at desc
         limit 1`,
        [from, otp]
      );
      if (rows.length) {
        await safeReply(from, `${check.label} ya verificado.`);
        return { ok: true };
      }
    }

    const pendingLoginRows = await fastify.pg.query(
      `select id, project_key, code, expires_at
       from whatsapp_login_requests
       where phone_e164 = $1 and verified_at is null
       order by created_at desc
       limit 1`,
      [from]
    );
    const pendingLogin = pendingLoginRows.rows[0] as PendingCodeRow | undefined;
    if (pendingLogin) {
      if (pendingLogin.expires_at <= new Date()) {
        await safeReply(from, invalidMsg);
        return { ok: true };
      }
      if (pendingLogin.code !== otp) {
        await updateAttempts(fastify, "whatsapp_login_requests", pendingLogin.id);
        await safeReply(from, invalidMsg);
        return { ok: true };
      }
      await markVerified(fastify, "whatsapp_login_requests", pendingLogin.id);
      await safeReply(from, "Login verificado. Vuelve a la app.");
      return { ok: true };
    }

    const pendingRegisterRows = await fastify.pg.query(
      `select id, project_key, code, expires_at
       from whatsapp_register_requests
       where phone_e164 = $1 and verified_at is null
       order by created_at desc
       limit 1`,
      [from]
    );
    const pendingRegister = pendingRegisterRows.rows[0] as PendingCodeRow | undefined;
    if (pendingRegister) {
      if (pendingRegister.expires_at <= new Date()) {
        await safeReply(from, invalidMsg);
        return { ok: true };
      }
      if (pendingRegister.code !== otp) {
        await updateAttempts(fastify, "whatsapp_register_requests", pendingRegister.id);
        await safeReply(from, invalidMsg);
        return { ok: true };
      }
      await markVerified(fastify, "whatsapp_register_requests", pendingRegister.id);
      await safeReply(from, "Registro verificado. Completa el registro en la app.");
      return { ok: true };
    }

    const pendingRecoveryRows = await fastify.pg.query(
      `select id, project_key, code, expires_at
       from whatsapp_recovery_requests
       where phone_e164 = $1 and verified_at is null
       order by created_at desc
       limit 1`,
      [from]
    );
    const pendingRecovery = pendingRecoveryRows.rows[0] as PendingCodeRow | undefined;
    if (pendingRecovery) {
      if (pendingRecovery.expires_at <= new Date()) {
        await safeReply(from, invalidMsg);
        return { ok: true };
      }
      if (pendingRecovery.code !== otp) {
        await updateAttempts(fastify, "whatsapp_recovery_requests", pendingRecovery.id);
        await safeReply(from, invalidMsg);
        return { ok: true };
      }
      await markVerified(fastify, "whatsapp_recovery_requests", pendingRecovery.id);
      await safeReply(from, "Recuperacion verificada. Completa el proceso en la app.");
      return { ok: true };
    }

    const pendingVerificationRows = await fastify.pg.query(
      `select vr.id, vr.project_key, vr.account_id, vr.code, vr.expires_at,
              a.firebase_uid, a.name, a.handle, a.phone_local, a.phone_prefix
       from whatsapp_verification_requests vr
       join whatsapp_accounts a on a.id = vr.account_id
       where vr.phone_e164 = $1 and vr.verified_at is null
       order by vr.created_at desc
       limit 1`,
      [from]
    );

    const pendingVerification = pendingVerificationRows.rows[0] as
      | (PendingCodeRow & {
          account_id: string;
          name: string | null;
          handle: string | null;
          phone_local: string | null;
          phone_prefix: string | null;
        })
      | undefined;

    if (!pendingVerification) {
      await safeReply(from, invalidMsg);
      return { ok: true };
    }

    if (pendingVerification.expires_at <= new Date()) {
      await safeReply(from, invalidMsg);
      return { ok: true };
    }

    if (pendingVerification.code !== otp) {
      await updateAttempts(fastify, "whatsapp_verification_requests", pendingVerification.id);
      await safeReply(from, invalidMsg);
      return { ok: true };
    }

    await markVerified(fastify, "whatsapp_verification_requests", pendingVerification.id);

    const { rows: accountRows } = await fastify.pg.query(
      `update whatsapp_accounts
       set whatsapp_verified = true,
           whatsapp_verified_at = now(),
           phone_e164 = $1,
           updated_at = now()
       where id = $2
       returning id, project_key, firebase_uid, name, handle, phone_local, phone_prefix, phone_e164, whatsapp_verified`,
      [from, pendingVerification.account_id]
    );

    const account = accountRows[0] as {
      project_key: string;
      firebase_uid: string;
      name: string | null;
      handle: string | null;
      phone_local: string | null;
      phone_prefix: string | null;
      phone_e164: string | null;
      whatsapp_verified: boolean;
    } | undefined;

    await safeReply(from, "WhatsApp verificado.");
    return { ok: true };
  });
};
