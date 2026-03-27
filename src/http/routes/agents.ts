import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../../config/env.js";
import { notFound } from "../../errors/HttpError.js";
import { parseOrThrow } from "../../config/zod.js";
import {
  buildProjectContext,
  listProjectAgents,
  loadProjectAgent,
  toPublicAgent
} from "../../agents/repository.js";

const paramsSchema = z.object({
  project_key: z.string().min(2).max(64)
});

function resolveDir(configuredPath: string, fallback: string) {
  const configured = configuredPath.trim() || fallback;
  return path.isAbsolute(configured)
    ? configured
    : path.resolve(process.cwd(), configured);
}

function resolveAgentsDir() {
  return resolveDir(env.AGENTS_DIR, "./agents");
}

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/agents", async () => {
    const agentsDir = resolveAgentsDir();
    const projects = await listProjectAgents(agentsDir);

    return {
      agents_dir: agentsDir,
      default_project: env.defaultProject,
      projects: projects.map((project) => toPublicAgent(project))
    };
  });

  fastify.get("/api/agents/:project_key", async (request) => {
    const params = parseOrThrow(paramsSchema, request.params);
    const agentsDir = resolveAgentsDir();

    const project = await loadProjectAgent(agentsDir, params.project_key);
    if (!project) {
      throw notFound("agent_project_not_found");
    }

    return {
      agents_dir: agentsDir,
      default_project: env.defaultProject,
      project: toPublicAgent(project)
    };
  });

  fastify.get("/api/agents/:project_key/context", async (request) => {
    const params = parseOrThrow(paramsSchema, request.params);
    const agentsDir = resolveAgentsDir();

    const project = await loadProjectAgent(agentsDir, params.project_key);
    if (!project) {
      throw notFound("agent_project_not_found");
    }

    return {
      project_key: project.project_key,
      context: buildProjectContext(project)
    };
  });
};
