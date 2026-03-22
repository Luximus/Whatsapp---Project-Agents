import path from "node:path";
import type { FastifyPluginAsync } from "fastify";
import { z } from "zod";
import { env } from "../env.js";
import { parseOrThrow } from "../lib/zod.js";
import {
  buildAgentContext,
  listProjectKeys,
  loadOrchestratorAgent,
  loadProjectAgent
} from "../agents/repository.js";

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

function resolveOrchestratorDir() {
  return resolveDir(env.ORCHESTRATOR_AGENT_DIR, "./agents/luxisoft");
}

function isDirectChild(parentDir: string, childDir: string) {
  const parent = path.resolve(parentDir);
  const childParent = path.dirname(path.resolve(childDir));
  return parent === childParent;
}

function toPublicAgent(agent: Awaited<ReturnType<typeof loadOrchestratorAgent>>) {
  return {
    project_key: agent.project_key,
    dir: agent.dir,
    prompt_file: agent.prompt_file,
    prompt: agent.prompt,
    scripts: agent.scripts.map((script) => ({
      name: script.name,
      file: script.file,
      description: script.description,
      parameters: script.parameters
    }))
  };
}

export const agentRoutes: FastifyPluginAsync = async (fastify) => {
  fastify.get("/api/agents", async () => {
    const agentsDir = resolveAgentsDir();
    const orchestratorDir = resolveOrchestratorDir();
    const orchestrator = await loadOrchestratorAgent(orchestratorDir);
    const excludedKeys = isDirectChild(agentsDir, orchestratorDir)
      ? [orchestrator.project_key]
      : [];
    const keys = await listProjectKeys(agentsDir, excludedKeys);
    const projects = [] as any[];

    for (const key of keys) {
      const project = await loadProjectAgent(agentsDir, key);
      if (project) projects.push(project);
    }

    return {
      agents_dir: agentsDir,
      orchestrator_dir: orchestratorDir,
      orchestrator: toPublicAgent(orchestrator),
      projects: projects.map((project) => toPublicAgent(project))
    };
  });

  fastify.get("/api/agents/:project_key", async (request) => {
    const params = parseOrThrow(paramsSchema, request.params);
    const agentsDir = resolveAgentsDir();
    const orchestratorDir = resolveOrchestratorDir();

    const orchestrator = await loadOrchestratorAgent(orchestratorDir);
    const project = await loadProjectAgent(agentsDir, params.project_key);
    if (!project) {
      throw Object.assign(new Error("agent_project_not_found"), { statusCode: 404 });
    }

    return {
      agents_dir: agentsDir,
      orchestrator_dir: orchestratorDir,
      orchestrator: toPublicAgent(orchestrator),
      project: toPublicAgent(project)
    };
  });

  fastify.get("/api/agents/:project_key/context", async (request) => {
    const params = parseOrThrow(paramsSchema, request.params);
    const agentsDir = resolveAgentsDir();
    const orchestratorDir = resolveOrchestratorDir();

    const orchestrator = await loadOrchestratorAgent(orchestratorDir);
    const project = await loadProjectAgent(agentsDir, params.project_key);
    if (!project) {
      throw Object.assign(new Error("agent_project_not_found"), { statusCode: 404 });
    }

    return {
      project_key: project.project_key,
      context: buildAgentContext({ orchestrator, project })
    };
  });
};
