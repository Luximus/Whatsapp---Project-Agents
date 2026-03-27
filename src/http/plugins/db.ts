import type { FastifyPluginAsync } from "fastify";
import fp from "fastify-plugin";
import { getPool, closePool } from "../../infrastructure/db/pool.js";

const plugin: FastifyPluginAsync = async (fastify) => {
  fastify.decorate("pg", getPool());

  fastify.addHook("onClose", async () => {
    await closePool();
  });
};

export const dbPlugin = fp(plugin, { name: "dbPlugin" });
