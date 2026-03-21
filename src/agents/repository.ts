import { promises as fs } from "node:fs";
import path from "node:path";

export type AgentScript = {
  name: string;
  file: string;
  content: string;
};

export type AgentDefinition = {
  project_key: string;
  prompt_file: string | null;
  prompt: string;
  scripts: AgentScript[];
};

function normalizeProjectKey(value: string) {
  return value.trim().toLowerCase();
}

async function safeStat(filePath: string) {
  try {
    return await fs.stat(filePath);
  } catch {
    return null;
  }
}

async function listTxtFiles(dirPath: string) {
  const stat = await safeStat(dirPath);
  if (!stat?.isDirectory()) return [] as string[];

  const entries = await fs.readdir(dirPath, { withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile() && entry.name.toLowerCase().endsWith(".txt"))
    .map((entry) => path.join(dirPath, entry.name))
    .sort((a, b) => a.localeCompare(b));
}

async function readUtf8(filePath: string) {
  const stat = await safeStat(filePath);
  if (!stat?.isFile()) return "";
  return fs.readFile(filePath, "utf8");
}

async function resolvePromptFile(dirPath: string, projectKey: string) {
  const preferredPrompt = path.join(dirPath, `${projectKey}.txt`);
  if ((await safeStat(preferredPrompt))?.isFile()) {
    return preferredPrompt;
  }
  const fallback = await listTxtFiles(dirPath);
  return fallback[0] ?? null;
}

async function loadScripts(dirPath: string): Promise<AgentScript[]> {
  const files = await listTxtFiles(dirPath);
  const scripts: AgentScript[] = [];
  for (const filePath of files) {
    scripts.push({
      name: path.basename(filePath, ".txt"),
      file: filePath,
      content: await readUtf8(filePath)
    });
  }
  return scripts;
}

export async function loadOrchestratorAgent(orchestratorDir: string): Promise<AgentDefinition> {
  const projectKey = normalizeProjectKey(path.basename(path.resolve(orchestratorDir))) || "orchestrator";
  const promptFile = await resolvePromptFile(orchestratorDir, projectKey);
  return {
    project_key: projectKey,
    prompt_file: promptFile,
    prompt: promptFile ? await readUtf8(promptFile) : "",
    scripts: await loadScripts(path.join(orchestratorDir, "scripts"))
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

  const promptFile = await resolvePromptFile(projectDir, normalized);

  return {
    project_key: normalized,
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
    lines.push(script.content || "");
    lines.push("");
  }

  lines.push(`[project:${input.project.project_key}.prompt]`);
  lines.push(input.project.prompt || "");
  lines.push("");

  for (const script of input.project.scripts) {
    lines.push(`[project:${input.project.project_key}.script:${script.name}]`);
    lines.push(script.content || "");
    lines.push("");
  }

  return lines.join("\n").trim();
}
