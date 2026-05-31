import type { ChatMessage } from "../ai/types.js";
import { loadAgent, listAgentProjects } from "./registry.js";
import { runAgent, type RunAgentResult } from "./runtime.js";
import type { AgentToolContext, LoadedAgent } from "./types.js";

export * from "./types.js";
export { loadAgent, listAgentProjects } from "./registry.js";
export { runAgent } from "./runtime.js";
export type { RunAgentOptions, RunAgentResult } from "./runtime.js";

// Cache de agentes cargados, por projectKey. Los scripts se importan una vez.
const agentCache = new Map<string, LoadedAgent>();

/** Devuelve el agente del proyecto (cacheado tras la primera carga). */
export async function getAgent(projectKey: string): Promise<LoadedAgent> {
  const key = projectKey.trim().toLowerCase();
  const cached = agentCache.get(key);
  if (cached) return cached;
  const agent = await loadAgent(key);
  agentCache.set(key, agent);
  return agent;
}

/** Limpia la cache (útil en tests o recarga en caliente). */
export function clearAgentCache() {
  agentCache.clear();
}

/**
 * Router de alto nivel: resuelve el agente del proyecto y ejecuta el mensaje.
 * Es el punto de entrada que usarían las rutas/webhook.
 */
export async function handleAgentMessage(input: {
  projectKey: string;
  userMessage: string;
  history?: ChatMessage[];
  context?: Partial<AgentToolContext>;
}): Promise<RunAgentResult> {
  const agent = await getAgent(input.projectKey);
  return runAgent({
    agent,
    userMessage: input.userMessage,
    history: input.history,
    context: {
      projectKey: agent.projectKey,
      from: input.context?.from ?? null,
      logger: input.context?.logger,
      actions: input.context?.actions
    }
  });
}

export { handleAgentMessage as routeAgentMessage };
