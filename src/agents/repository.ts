import { promises as fs } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type AgentScriptRuntimeContext = {
  projectKey: string;
  phoneE164: string;
  userMessage: string;
  history: Array<{ role: "user" | "assistant"; text: string }>;
  sources: string[];
  searchKnowledge: (
    query: string,
    options?: {
      sourceUrl?: string;
    }
  ) => Promise<string[]>;
};

export type AgentScript = {
  name: string;
  file: string;
  description: string;
  parameters: Record<string, unknown>;
  source: string;
  run: (input: Record<string, unknown>, context: AgentScriptRuntimeContext) => Promise<unknown>;
};

export type AgentDefinition = {
  project_key: string;
  dir: string;
  prompt_file: string | null;
  prompt: string;
  scripts: AgentScript[];
};

const PROMPT_FILE = "services.txt";

function normalizeProjectKey(value: string) {
  return value.trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

async function safeStat(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function readUtf8(filePath: string) {
  const stat = await safeStat(filePath);
  if (!stat?.isFile()) return "";
  return fs.readFile(filePath, "utf8");
}

async function listFilesByExtension(dirPath: string, extension: string) {
  const stat = await safeStat(dirPath);
  if (!stat?.isDirectory()) return [] as string[];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(extension))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function loadPromptFile(dirPath: string) {
  const promptFile = path.join(dirPath, PROMPT_FILE);
  if ((await safeStat(promptFile))?.isFile()) {
    return promptFile;
  }
  return null;
}

function normalizeScriptParameters(value: unknown) {
  if (!isRecord(value)) {
    return {
      type: "object",
      properties: {},
      additionalProperties: true
    } as Record<string, unknown>;
  }
  return value;
}

function toRunnableScript(definition: {
  filePath: string;
  source: string;
  moduleValue: unknown;
}): AgentScript | null {
  const candidate = isRecord(definition.moduleValue) ? definition.moduleValue : null;
  if (!candidate) return null;

  const name = typeof candidate.name === "string" ? candidate.name.trim() : "";
  const description = typeof candidate.description === "string" ? candidate.description.trim() : "";
  const run = candidate.run;

  if (!name || !description || typeof run !== "function") {
    return null;
  }

  return {
    name,
    file: definition.filePath,
    description,
    parameters: normalizeScriptParameters(candidate.parameters),
    source: definition.source,
    run: async (input, context) => {
      const output = await run(input, context);
      return output ?? {};
    }
  };
}

async function loadScriptModule(filePath: string): Promise<AgentScript | null> {
  const source = await readUtf8(filePath);
  if (!source.trim()) return null;

  try {
    const href = pathToFileURL(filePath).href;
    const loaded = (await import(href)) as Record<string, unknown>;
    const moduleValue = loaded.default ?? loaded.tool ?? loaded;
    return toRunnableScript({ filePath, source, moduleValue });
  } catch {
    return null;
  }
}

async function loadScripts(dirPath: string): Promise<AgentScript[]> {
  const files = await listFilesByExtension(dirPath, ".js");
  const scripts: AgentScript[] = [];

  for (const filePath of files) {
    const loaded = await loadScriptModule(filePath);
    if (loaded) scripts.push(loaded);
  }

  return scripts;
}

export async function loadOrchestratorAgent(orchestratorDir: string): Promise<AgentDefinition> {
  const resolved = path.resolve(orchestratorDir);
  const projectKey = normalizeProjectKey(path.basename(resolved)) || "orchestrator";
  const promptFile = await loadPromptFile(resolved);
  return {
    project_key: projectKey,
    dir: resolved,
    prompt_file: promptFile,
    prompt: promptFile ? await readUtf8(promptFile) : "",
    scripts: await loadScripts(path.join(resolved, "scripts"))
  };
}

export async function listProjectKeys(agentsDir: string, excludedKeys: string[] = []) {
  const stat = await safeStat(agentsDir);
  if (!stat?.isDirectory()) return [] as string[];

  const excluded = new Set(excludedKeys.map((item) => normalizeProjectKey(item)).filter(Boolean));
  const entries = await fs.readdir(agentsDir, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .filter((name) => {
      const normalized = normalizeProjectKey(name);
      if (!normalized) return false;
      if (normalized === "scripts") return false;
      return !excluded.has(normalized);
    })
    .sort((a, b) => a.localeCompare(b));
}

export async function loadProjectAgent(agentsDir: string, projectKey: string): Promise<AgentDefinition | null> {
  const normalized = normalizeProjectKey(projectKey);
  const projectDir = path.join(agentsDir, normalized);
  const stat = await safeStat(projectDir);
  if (!stat?.isDirectory()) return null;

  const promptFile = await loadPromptFile(projectDir);
  return {
    project_key: normalized,
    dir: projectDir,
    prompt_file: promptFile,
    prompt: promptFile ? await readUtf8(promptFile) : "",
    scripts: await loadScripts(path.join(projectDir, "scripts"))
  };
}

export function buildAgentContext(input: {
  orchestrator: AgentDefinition;
  project: AgentDefinition;
}) {
  const lines: string[] = [];
  lines.push("[orchestrator.prompt]");
  lines.push(input.orchestrator.prompt || "");
  lines.push("");

  for (const script of input.orchestrator.scripts) {
    lines.push(`[orchestrator.script:${script.name}]`);
    lines.push(`description=${script.description}`);
    lines.push(JSON.stringify(script.parameters));
    lines.push("");
  }

  lines.push(`[project:${input.project.project_key}.prompt]`);
  lines.push(input.project.prompt || "");
  lines.push("");

  for (const script of input.project.scripts) {
    lines.push(`[project:${input.project.project_key}.script:${script.name}]`);
    lines.push(`description=${script.description}`);
    lines.push(JSON.stringify(script.parameters));
    lines.push("");
  }

  return lines.join("\n").trim();
}
