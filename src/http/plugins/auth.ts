import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { getFirebaseAdminAuth } from "../../infrastructure/firebase/admin.js";
import { HttpError, unauthorized } from "../../errors/HttpError.js";

function parseBearer(authHeader: unknown) {
  if (typeof authHeader !== "string") return null;
  const match = authHeader.match(/^Bearer\s+(.+)$/i);
  return match?.[1] ?? null;
}

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("authenticate", async (request: any) => {
    const token = parseBearer(request.headers.authorization);
    if (!token) {
      throw unauthorized();
    }

    const firebaseAuth = getFirebaseAdminAuth();
    let decoded: any;
    try {
      decoded = await firebaseAuth.verifyIdToken(token);
    } catch (err: any) {
      throw new HttpError(401, "unauthorized", {
        firebaseCode: err?.code,
        firebaseMessage: err?.message
      });
    }

    request.user = {
      uid: String(decoded?.uid ?? ""),
      email: decoded?.email ? String(decoded.email) : undefined,
      name: decoded?.name ? String(decoded.name) : undefined,
      picture: decoded?.picture ? String(decoded.picture) : null
    };

    if (!request.user.uid) {
      throw unauthorized();
    }
  });
};

export const authPlugin = fp(plugin, { name: "authPlugin" });
