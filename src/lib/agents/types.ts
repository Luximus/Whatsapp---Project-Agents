import type { ChatToolDefinition } from "../ai/types.js";

/**
 * Contrato de una tool de agente. Cada `agents/<proyecto>/scripts/*.js` debe
 * exportar por defecto (o como `tool`) un objeto que cumpla esta interfaz.
 *
 * El runtime NO usa `eval`: carga los scripts por `import()` dinámico desde una
 * carpeta controlada (allowlist por estructura de directorios).
 */
export interface AgentTool {
  /** Nombre único dentro del agente; es el que ve el modelo. */
  name: string;
  description?: string;
  /** JSON Schema de los parámetros que recibe `execute`. */
  parameters: Record<string, unknown>;
  /**
   * Ejecuta la tool. `args` es el JSON ya parseado de los argumentos del
   * modelo. Debe devolver un string (lo que verá el modelo como resultado).
   */
  execute: (args: Record<string, unknown>, context: AgentToolContext) => Promise<string> | string;
}

/** Contexto que el runtime pasa a cada tool en su ejecución. */
export interface AgentToolContext {
  projectKey: string;
  /** Teléfono E164 del interlocutor, si aplica. */
  from?: string | null;
  /** Logger inyectable (Fastify u otro). */
  logger?: Pick<Console, "info" | "warn" | "error">;
}

/** Un agente cargado: prompt de sistema + sus tools. */
export interface LoadedAgent {
  projectKey: string;
  systemPrompt: string;
  tools: AgentTool[];
  /** Proveedor/modelo override para este agente (opcional). */
  chatProvider?: string;
  chatModel?: string;
}

export function toChatToolDefinition(tool: AgentTool): ChatToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: tool.parameters
  };
}
