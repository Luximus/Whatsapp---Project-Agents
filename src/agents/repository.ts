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

async function listFilesByExtensions(dirPath: string, extensions: string[]) {
  const stat = await safeStat(dirPath);
  if (!stat?.isDirectory()) return [] as string[];

  const normalizedExtensions = new Set(extensions.map((item) => item.toLowerCase()));
  const output: string[] = [];

  const walk = async (currentDir: string) => {
    const entries = await fs.readdir(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const resolved = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        await walk(resolved);
        continue;
      }
      if (!entry.isFile()) continue;

      const ext = path.extname(entry.name).toLowerCase();
      if (!normalizedExtensions.has(ext)) continue;
      output.push(resolved);
    }
  };

  await walk(dirPath);
  return output.sort((a, b) => a.localeCompare(b));
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
    if (path.extname(filePath).toLowerCase() !== ".ts") {
      return null;
    }

    const fallbackJs = filePath.slice(0, -3) + ".js";
    const fallbackStat = await safeStat(fallbackJs);
    if (!fallbackStat?.isFile()) {
      return null;
    }

    try {
      const fallbackSource = await readUtf8(fallbackJs);
      if (!fallbackSource.trim()) return null;

      const href = pathToFileURL(fallbackJs).href;
      const loaded = (await import(href)) as Record<string, unknown>;
      const moduleValue = loaded.default ?? loaded.tool ?? loaded;
      return toRunnableScript({
        filePath: fallbackJs,
        source: fallbackSource,
        moduleValue
      });
    } catch {
      return null;
    }
  }
}

async function loadScripts(dirPath: string): Promise<AgentScript[]> {
  const files = await listFilesByExtensions(dirPath, [".js", ".ts"]);
  const scripts: AgentScript[] = [];

  for (const filePath of files) {
    const loaded = await loadScriptModule(filePath);
    if (loaded) scripts.push(loaded);
  }

  return scripts;
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

export async function listProjectAgents(agentsDir: string, excludedKeys: string[] = []) {
  const keys = await listProjectKeys(agentsDir, excludedKeys);
  const loaded = await Promise.all(keys.map((key) => loadProjectAgent(agentsDir, key)));
  return loaded.filter((item): item is AgentDefinition => !!item);
}

export function toPublicAgent(agent: AgentDefinition) {
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

export function buildProjectContext(project: AgentDefinition) {
  const lines: string[] = [];
  lines.push(`[project:${project.project_key}.prompt]`);
  lines.push(project.prompt || "");
  lines.push("");

  for (const script of project.scripts) {
    lines.push(`[project:${project.project_key}.script:${script.name}]`);
    lines.push(`description=${script.description}`);
    lines.push(JSON.stringify(script.parameters));
    lines.push("");
  }

  return lines.join("\n").trim();
}
