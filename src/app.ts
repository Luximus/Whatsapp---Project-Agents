import Fastify from "fastify";
import cors from "@fastify/cors";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import { env } from "./config/env.js";
import { dbPlugin } from "./http/plugins/db.js";
import { authPlugin } from "./http/plugins/auth.js";
import { healthRoutes } from "./http/routes/health.js";
import { webhookRoutes } from "./http/routes/webhooks.js";
import { whatsappRoutes } from "./http/routes/whatsapp.js";
import { agentRoutes } from "./http/routes/agents.js";
import { bridgeRoutes } from "./http/routes/bridge.js";

export function buildApp() {
  const app = Fastify({
    logger: { level: env.LOG_LEVEL }
  });

  app.setErrorHandler((error: any, request, reply) => {
    const statusCode =
      error?.statusCode ??
      (error?.code === "23505" ? 409 : undefined) ??
      500;

    if (statusCode >= 500) {
      app.log.error(
        {
          err: error,
          statusCode,
          method: request?.method,
          url: request?.url
        },
        "Request failed"
      );
    }

    reply.code(statusCode).send({
      error:
        statusCode === 401
          ? "unauthorized"
          : statusCode === 404
            ? "not_found"
            : statusCode === 409
              ? "conflict"
              : statusCode === 429
                ? "too_many_requests"
                : statusCode === 500
                  ? "internal_error"
                  : "bad_request",
      message: error?.message ?? "unknown_error",
      details: error?.details
    });
  });

  return app
    .register(cors, {
      origin: env.corsOrigins.length ? env.corsOrigins : true,
      credentials: true,
      methods: ["GET", "HEAD", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
      allowedHeaders: [
        "authorization",
        "content-type",
        "x-project-key",
        "x-project-api-key",
        "x-bridge-dispatch-token"
      ]
    })
    .register(helmet)
    .register(rateLimit, { max: 200, timeWindow: "1 minute" })
    .register(dbPlugin)
    .register(authPlugin)
    .register(healthRoutes)
    .register(webhookRoutes)
    .register(whatsappRoutes)
    .register(bridgeRoutes)
    .register(agentRoutes);
}
