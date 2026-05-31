import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import type { AgentTool, LoadedAgent } from "./types.js";

/**
 * Raíz de definiciones de agentes. Cada subcarpeta es un proyecto:
 *   agents/<proyecto>/services.txt   -> prompt de sistema
 *   agents/<proyecto>/scripts/*.js   -> tools
 *
 * La carga por `import()` se restringe a esta carpeta (allowlist por
 * estructura): nunca se importa una ruta arbitraria provista por el usuario.
 */
const AGENTS_ROOT = path.resolve(process.cwd(), "agents");

function isAgentTool(value: unknown): value is AgentTool {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.name === "string" &&
    typeof candidate.execute === "function" &&
    typeof candidate.parameters === "object" &&
    candidate.parameters !== null
  );
}

/** Normaliza la key de proyecto y evita path traversal. */
function safeProjectKey(projectKey: string): string {
  const normalized = projectKey.trim().toLowerCase();
  if (!normalized || !/^[a-z0-9_-]+$/.test(normalized)) {
    throw new Error(`invalid_agent_project_key:${projectKey}`);
  }
  return normalized;
}

async function loadToolsFromDir(scriptsDir: string): Promise<AgentTool[]> {
  if (!fs.existsSync(scriptsDir)) return [];

  const entries = fs
    .readdirSync(scriptsDir, { withFileTypes: true })
    .filter((entry) => entry.isFile() && /\.(mjs|cjs|js)$/.test(entry.name))
    .map((entry) => entry.name)
    .sort();

  const tools: AgentTool[] = [];
  const seen = new Set<string>();

  for (const fileName of entries) {
    const fullPath = path.join(scriptsDir, fileName);
    const moduleUrl = pathToFileURL(fullPath).href;
    const imported = await import(moduleUrl);
    const candidate = imported.default ?? imported.tool ?? imported;

    if (!isAgentTool(candidate)) {
      throw new Error(`invalid_agent_tool_export:${fileName}`);
    }
    if (seen.has(candidate.name)) {
      throw new Error(`duplicate_agent_tool_name:${candidate.name}`);
    }
    seen.add(candidate.name);
    tools.push(candidate);
  }

  return tools;
}

/** Carga un agente desde disco. Lanza si no existe `services.txt`. */
export async function loadAgent(projectKey: string): Promise<LoadedAgent> {
  const key = safeProjectKey(projectKey);
  const agentDir = path.join(AGENTS_ROOT, key);
  const promptPath = path.join(agentDir, "services.txt");

  if (!fs.existsSync(promptPath)) {
    throw new Error(`agent_prompt_not_found:${key}`);
  }

  const systemPrompt = fs.readFileSync(promptPath, "utf8").trim();
  if (!systemPrompt) {
    throw new Error(`agent_prompt_empty:${key}`);
  }

  const tools = await loadToolsFromDir(path.join(agentDir, "scripts"));

  return { projectKey: key, systemPrompt, tools };
}

/** Lista las keys de proyecto que tienen una carpeta de agente válida. */
export function listAgentProjects(): string[] {
  if (!fs.existsSync(AGENTS_ROOT)) return [];
  return fs
    .readdirSync(AGENTS_ROOT, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .filter((entry) => fs.existsSync(path.join(AGENTS_ROOT, entry.name, "services.txt")))
    .map((entry) => entry.name)
    .sort();
}

export { AGENTS_ROOT, safeProjectKey };
