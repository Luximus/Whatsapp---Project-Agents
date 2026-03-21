import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { getFirebaseAdminAuth } from "../lib/firebaseAdmin.js";

function parseBearer(authHeader: unknown) {
  if (typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("authenticate", async (request) => {
    const token = parseBearer(request.headers.authorization);
    if (!token) {
      throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    }

    const firebaseAuth = getFirebaseAdminAuth();
    let decoded: any;
    try {
      decoded = await firebaseAuth.verifyIdToken(token);
    } catch (err: any) {
      throw Object.assign(new Error("unauthorized"), {
        statusCode: 401,
        details: {
          firebaseCode: err?.code,
          firebaseMessage: err?.message
        }
      });
    }

    request.user = {
      uid: String(decoded?.uid ?? ""),
      email: decoded?.email ? String(decoded.email) : undefined,
      name: decoded?.name ? String(decoded.name) : undefined,
      picture: decoded?.picture ? String(decoded.picture) : null
    };

    if (!request.user.uid) {
      throw Object.assign(new Error("unauthorized"), { statusCode: 401 });
    }
  });
};

export const authPlugin = fp(plugin, { name: "authPlugin" });
