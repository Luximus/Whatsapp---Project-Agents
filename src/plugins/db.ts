import type { FastifyPluginAsync } from "fastify";
import { configureInboxOwnershipReader } from "../lib/inboxAiOwnership.js";
import fp from "fastify-plugin";
import { Pool } from "pg";
import { env } from "../env.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  const pool = new Pool({ connectionString: env.DATABASE_URL });
  fastify.decorate("pg", pool);
  configureInboxOwnershipReader(pool);

  fastify.addHook("onClose", async () => {
    await pool.end();
    configureInboxOwnershipReader(null);
  });
};

export const dbPlugin = fp(plugin, { name: "dbPlugin" });
