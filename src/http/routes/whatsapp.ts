import { randomUUID } from "node:crypto";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { badRequest, notFound, conflict, tooManyRequests, internalError } from "../../errors/HttpError.js";
import { getFirebaseAdminAuth } from "../../infrastructure/firebase/admin.js";
import { buildWaUrl, normalizeE164 } from "../../domain/whatsapp/otpExtractor.js";
import { parseOrThrow } from "../../config/zod.js";
import { resolveProjectKey } from "../../http/helpers/projectKey.js";
import { requireUser } from "../../http/helpers/requestUser.js";
import {
  upsertAccountByFirebase,
  findAccountByPhone
} from "../../infrastructure/db/queries/accounts.js";
import { ensureProjectActive } from "../../infrastructure/db/queries/projects.js";

const E164_REGEX = /^\+\d{8,16}$/;

const startBody = z.object({
  phone_e164: z.string().min(1).max(40),
  project_key: z.string().min(2).max(64).optional()
});

const loginStartBody = z.object({
  phone_e164: z.string().min(1).max(40),
  project_key: z.string().min(2).max(64).optional()
});

const registerStartBody = z.object({
  phone_e164: z.string().min(1).max(40),
  project_key: z.string().min(2).max(64).optional()
});

const recoveryStartBody = z.object({
  phone_e164: z.string().min(1).max(40),
  project_key: z.string().min(2).max(64).optional()
});

const statusQuery = z.object({
  session_id: z.string().min(8).max(128),
  project_key: z.string().min(2).max(64).optional()
});

const verificationStatusQuery = z.object({
  project_key: z.string().min(2).max(64).optional()
});

const registerCompleteBody = z.object({
  session_id: z.string().min(8).max(128),
  name: z.string().min(1).max(80),
  handle: z.string().min(2).max(32).regex(/^[a-zA-Z0-9._]+$/),
  phone_e164: z.string().min(1).max(40),
  phone_prefix: z.string().regex(/^\+\d{1,4}$/),
  phone_local: z.string().regex(/^\d{5,16}$/),
  project_key: z.string().min(2).max(64).optional()
});

const recoveryCompleteBody = z.object({
  session_id: z.string().min(8).max(128),
  phone_e164: z.string().min(1).max(40),
  new_password: z.string().min(6).max(128),
  project_key: z.string().min(2).max(64).optional()
});

function requireE164(value: string) {
  const normalized = normalizeE164(value);
  if (!normalized || !E164_REGEX.test(normalized)) {
    throw badRequest("whatsapp_invalid_phone");
  }
  return normalized;
}

function makeCode() {
  return String(Math.floor(1000 + Math.random() * 9000));
}

export const whatsappRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.post(
    "/api/whatsapp/verification/start",
    {
      preHandler: fastify.authenticate,
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
          keyGenerator: (request: any) => request.user?.uid ?? request.ip
        }
      }
    },
    async (request) => {
      const body = parseOrThrow(startBody, request.body);
      const projectKey = resolveProjectKey(request, body.project_key);
      await ensureProjectActive(fastify.pg, projectKey);

      const user = requireUser(request);
      const account = await upsertAccountByFirebase(fastify.pg, {
        projectKey,
        firebaseUid: user.uid,
        email: user.email,
        name: user.name
      });
      const phoneE164 = requireE164(body.phone_e164);

      if (!env.WHATSAPP_VERIFY_NUMBER_E164) {
        throw internalError("whatsapp_verify_number_missing");
      }

      const { rows: existingRows } = await fastify.pg.query(
        `select attempts, expires_at, verified_at
         from whatsapp_verification_requests
         where project_key = $1 and account_id = $2
         limit 1`,
        [projectKey, account.id]
      );

      const existing = existingRows[0] as {
        attempts: number;
        expires_at: Date;
        verified_at: Date | null;
      } | undefined;

      const now = new Date();
      if (existing && !existing.verified_at && existing.attempts >= 5 && existing.expires_at > now) {
        throw tooManyRequests("whatsapp_too_many_attempts");
      }

      const code = makeCode();
      const expiresAt = new Date(now.getTime() + 5 * 60 * 1000);

      await fastify.pg.query(
        `insert into whatsapp_verification_requests (project_key, account_id, phone_e164, code, expires_at, attempts)
         values ($1,$2,$3,$4,$5,0)
         on conflict (project_key, account_id) do update set
           phone_e164 = excluded.phone_e164,
           code = excluded.code,
           expires_at = excluded.expires_at,
           attempts = 0,
           verified_at = null,
           updated_at = now()`,
        [projectKey, account.id, phoneE164, code, expiresAt]
      );

      const message = `Hola, mi codigo de confirmacion es ${code}`;
      const waUrl = buildWaUrl(env.WHATSAPP_VERIFY_NUMBER_E164, message);
      return {
        project_key: projectKey,
        wa_url: waUrl,
        expires_at: expiresAt.toISOString()
      };
    }
  );

  fastify.get(
    "/api/whatsapp/verification/status",
    { preHandler: fastify.authenticate },
    async (request) => {
      const query = parseOrThrow(verificationStatusQuery, request.query);
      const projectKey = resolveProjectKey(request, query.project_key);
      await ensureProjectActive(fastify.pg, projectKey);

      const user = requireUser(request);
      const account = await upsertAccountByFirebase(fastify.pg, {
        projectKey,
        firebaseUid: user.uid,
        email: user.email,
        name: user.name
      });

      const { rows: pendingRows } = await fastify.pg.query(
        `select phone_e164, expires_at
         from whatsapp_verification_requests
         where project_key = $1
           and account_id = $2
           and verified_at is null
           and expires_at > now()
         order by created_at desc
         limit 1`,
        [projectKey, account.id]
      );

      const pending = pendingRows[0] as { phone_e164: string; expires_at: Date } | undefined;

      return {
        project_key: projectKey,
        whatsapp_verified: account.whatsapp_verified,
        whatsapp_number: account.phone_e164,
        pending_expires_at: pending?.expires_at?.toISOString() ?? null,
        pending_phone_e164: pending?.phone_e164 ?? null
      };
    }
  );

  fastify.post(
    "/api/whatsapp/login/start",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
          keyGenerator: (request: any) => request.ip
        }
      }
    },
    async (request) => {
      const body = parseOrThrow(loginStartBody, request.body);
      const projectKey = resolveProjectKey(request, body.project_key);
      await ensureProjectActive(fastify.pg, projectKey);

      const phoneE164 = requireE164(body.phone_e164);
      if (!env.WHATSAPP_VERIFY_NUMBER_E164) {
        throw internalError("whatsapp_verify_number_missing");
      }

      const account = await findAccountByPhone(fastify.pg, projectKey, phoneE164);
      if (!account || !account.whatsapp_verified) {
        throw notFound("whatsapp_login_not_linked");
      }

      const code = makeCode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const sessionId = randomUUID();

      await fastify.pg.query(
        `insert into whatsapp_login_requests (project_key, session_id, phone_e164, code, expires_at, attempts)
         values ($1,$2,$3,$4,$5,0)`,
        [projectKey, sessionId, phoneE164, code, expiresAt]
      );

      const message = `Hola, mi codigo de inicio de sesion es ${code}`;
      const waUrl = buildWaUrl(env.WHATSAPP_VERIFY_NUMBER_E164, message);

      return {
        project_key: projectKey,
        wa_url: waUrl,
        expires_at: expiresAt.toISOString(),
        session_id: sessionId
      };
    }
  );

  fastify.get("/api/whatsapp/login/status", async (request) => {
    const query = parseOrThrow(statusQuery, request.query);
    const projectKey = resolveProjectKey(request, query.project_key);
    await ensureProjectActive(fastify.pg, projectKey);

    const { rows } = await fastify.pg.query(
      `select phone_e164, verified_at, expires_at
       from whatsapp_login_requests
       where project_key = $1
         and session_id = $2
       limit 1`,
      [projectKey, query.session_id]
    );

    const row = rows[0] as { phone_e164: string; verified_at: Date | null; expires_at: Date } | undefined;
    if (!row) return { status: "expired" as const };
    if (row.expires_at <= new Date()) return { status: "expired" as const };
    if (!row.verified_at) return { status: "pending" as const };

    const account = await findAccountByPhone(fastify.pg, projectKey, row.phone_e164);
    if (!account || !account.firebase_uid || !account.whatsapp_verified) {
      return { status: "expired" as const };
    }

    const adminAuth = getFirebaseAdminAuth();
    const token = await adminAuth.createCustomToken(account.firebase_uid);
    return { status: "verified" as const, firebase_token: token };
  });

  fastify.post(
    "/api/whatsapp/register/start",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
          keyGenerator: (request: any) => request.ip
        }
      }
    },
    async (request) => {
      const body = parseOrThrow(registerStartBody, request.body);
      const projectKey = resolveProjectKey(request, body.project_key);
      await ensureProjectActive(fastify.pg, projectKey);

      const phoneE164 = requireE164(body.phone_e164);
      if (!env.WHATSAPP_VERIFY_NUMBER_E164) {
        throw internalError("whatsapp_verify_number_missing");
      }

      const existing = await findAccountByPhone(fastify.pg, projectKey, phoneE164);
      if (existing?.phone_e164) {
        throw conflict("whatsapp_number_in_use");
      }

      const code = makeCode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const sessionId = randomUUID();

      await fastify.pg.query(
        `insert into whatsapp_register_requests (project_key, session_id, phone_e164, code, expires_at, attempts)
         values ($1,$2,$3,$4,$5,0)`,
        [projectKey, sessionId, phoneE164, code, expiresAt]
      );

      const message = `Hola, mi codigo de registro es ${code}`;
      const waUrl = buildWaUrl(env.WHATSAPP_VERIFY_NUMBER_E164, message);

      return {
        project_key: projectKey,
        wa_url: waUrl,
        expires_at: expiresAt.toISOString(),
        session_id: sessionId
      };
    }
  );

  fastify.get("/api/whatsapp/register/status", async (request) => {
    const query = parseOrThrow(statusQuery, request.query);
    const projectKey = resolveProjectKey(request, query.project_key);
    await ensureProjectActive(fastify.pg, projectKey);

    const { rows } = await fastify.pg.query(
      `select phone_e164, verified_at, expires_at
       from whatsapp_register_requests
       where project_key = $1
         and session_id = $2
       limit 1`,
      [projectKey, query.session_id]
    );

    const row = rows[0] as { phone_e164: string; verified_at: Date | null; expires_at: Date } | undefined;
    if (!row) return { status: "expired" as const };
    if (row.expires_at <= new Date()) return { status: "expired" as const };
    if (!row.verified_at) return { status: "pending" as const };

    return { status: "verified" as const, phone_e164: row.phone_e164 };
  });

  fastify.post(
    "/api/whatsapp/register/complete",
    { preHandler: fastify.authenticate },
    async (request) => {
      const body = parseOrThrow(registerCompleteBody, request.body);
      const projectKey = resolveProjectKey(request, body.project_key);
      await ensureProjectActive(fastify.pg, projectKey);

      const phoneE164 = requireE164(body.phone_e164);
      const user = requireUser(request);
      const account = await upsertAccountByFirebase(fastify.pg, {
        projectKey,
        firebaseUid: user.uid,
        email: user.email,
        name: user.name
      });

      const { rows: sessionRows } = await fastify.pg.query(
        `select phone_e164, verified_at, expires_at
         from whatsapp_register_requests
         where project_key = $1
           and session_id = $2
         limit 1`,
        [projectKey, body.session_id]
      );

      const session = sessionRows[0] as {
        phone_e164: string;
        verified_at: Date | null;
        expires_at: Date;
      } | undefined;

      if (!session || session.expires_at <= new Date() || !session.verified_at) {
        throw conflict("whatsapp_register_not_verified");
      }
      if (session.phone_e164 !== phoneE164) {
        throw conflict("whatsapp_register_phone_mismatch");
      }

      const { rows: handleRows } = await fastify.pg.query(
        `select 1
         from whatsapp_accounts
         where project_key = $1
           and lower(handle) = lower($2)
           and firebase_uid <> $3
         limit 1`,
        [projectKey, body.handle, account.firebase_uid]
      );
      if (handleRows.length) {
        throw conflict("handle_in_use");
      }

      await fastify.pg.query(
        `update whatsapp_accounts
         set name = $1,
             handle = $2,
             phone_local = $3,
             phone_prefix = $4,
             phone_e164 = $5,
             whatsapp_verified = true,
             whatsapp_verified_at = now(),
             updated_at = now()
         where id = $6
         returning id, project_key, firebase_uid, email, name, handle, phone_e164, phone_prefix, phone_local, whatsapp_verified, whatsapp_verified_at`,
        [body.name, body.handle, body.phone_local, body.phone_prefix, phoneE164, account.id]
      );

      return { ok: true, project_key: projectKey };
    }
  );

  fastify.post(
    "/api/whatsapp/recovery/start",
    {
      config: {
        rateLimit: {
          max: 3,
          timeWindow: "1 minute",
          keyGenerator: (request: any) => request.ip
        }
      }
    },
    async (request) => {
      const body = parseOrThrow(recoveryStartBody, request.body);
      const projectKey = resolveProjectKey(request, body.project_key);
      await ensureProjectActive(fastify.pg, projectKey);

      const phoneE164 = requireE164(body.phone_e164);
      if (!env.WHATSAPP_VERIFY_NUMBER_E164) {
        throw internalError("whatsapp_verify_number_missing");
      }

      const account = await findAccountByPhone(fastify.pg, projectKey, phoneE164);
      if (!account || !account.whatsapp_verified) {
        throw notFound("whatsapp_recovery_not_linked");
      }

      const code = makeCode();
      const expiresAt = new Date(Date.now() + 5 * 60 * 1000);
      const sessionId = randomUUID();

      await fastify.pg.query(
        `insert into whatsapp_recovery_requests (project_key, session_id, phone_e164, code, expires_at, attempts)
         values ($1,$2,$3,$4,$5,0)`,
        [projectKey, sessionId, phoneE164, code, expiresAt]
      );

      const message = `Hola, mi codigo de recuperacion es ${code}`;
      const waUrl = buildWaUrl(env.WHATSAPP_VERIFY_NUMBER_E164, message);

      return {
        project_key: projectKey,
        wa_url: waUrl,
        expires_at: expiresAt.toISOString(),
        session_id: sessionId
      };
    }
  );

  fastify.get("/api/whatsapp/recovery/status", async (request) => {
    const query = parseOrThrow(statusQuery, request.query);
    const projectKey = resolveProjectKey(request, query.project_key);
    await ensureProjectActive(fastify.pg, projectKey);

    const { rows } = await fastify.pg.query(
      `select phone_e164, verified_at, expires_at
       from whatsapp_recovery_requests
       where project_key = $1
         and session_id = $2
       limit 1`,
      [projectKey, query.session_id]
    );

    const row = rows[0] as { phone_e164: string; verified_at: Date | null; expires_at: Date } | undefined;
    if (!row) return { status: "expired" as const };
    if (row.expires_at <= new Date()) return { status: "expired" as const };
    if (!row.verified_at) return { status: "pending" as const };

    return { status: "verified" as const, phone_e164: row.phone_e164 };
  });

  fastify.post("/api/whatsapp/recovery/complete", async (request) => {
    const body = parseOrThrow(recoveryCompleteBody, request.body);
    const projectKey = resolveProjectKey(request, body.project_key);
    await ensureProjectActive(fastify.pg, projectKey);

    const phoneE164 = requireE164(body.phone_e164);

    const { rows: sessionRows } = await fastify.pg.query(
      `select phone_e164, verified_at, expires_at
       from whatsapp_recovery_requests
       where project_key = $1
         and session_id = $2
       limit 1`,
      [projectKey, body.session_id]
    );

    const session = sessionRows[0] as {
      phone_e164: string;
      verified_at: Date | null;
      expires_at: Date;
    } | undefined;

    if (!session || session.expires_at <= new Date() || !session.verified_at) {
      throw conflict("whatsapp_recovery_not_verified");
    }
    if (session.phone_e164 !== phoneE164) {
      throw conflict("whatsapp_recovery_phone_mismatch");
    }

    const account = await findAccountByPhone(fastify.pg, projectKey, phoneE164);
    if (!account?.firebase_uid) {
      throw notFound("whatsapp_recovery_user_missing");
    }

    const adminAuth = getFirebaseAdminAuth();
    await adminAuth.updateUser(account.firebase_uid, { password: body.new_password });

    return { ok: true, project_key: projectKey };
  });
};
