import { promises as fs } from "node:fs";
import path from "node:path";
import OpenAI from "openai";
import {
  listProjectKeys,
  loadOrchestratorAgent,
  loadProjectAgent,
  type AgentScriptRuntimeContext
} from "../agents/repository.js";
import { env } from "../env.js";
import { normalizeE164, sendWhatsappText } from "./whatsapp.js";

type AgentReply = {
  handled: boolean;
  projectKey: string;
  reply: string;
  escalated: boolean;
  escalationSent: boolean;
};

type ConversationState = {
  projectKey: string;
  history: Array<{ role: "user" | "assistant"; text: string; at: number }>;
};

type CachedKnowledge = {
  loadedAt: number;
  text: string;
};

const knowledgeCache = new Map<string, CachedKnowledge>();
const conversations = new Map<string, ConversationState>();

const KNOWLEDGE_CACHE_TTL_MS = 10 * 60 * 1000;
const MAX_HISTORY_ITEMS = 12;
const MAX_RESPONSE_CHARS = 1400;

const DEFAULT_PROJECT_SOURCES: Record<string, string[]> = {
  luxisoft: ["https://luxisoft.com"],
  navai: ["https://navai.luxisoft.com"],
  luxichat: []
};

let openaiClient: OpenAI | null = null;

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
  return resolveDir(env.ORCHESTRATOR_AGENT_DIR, "./agents/orchestrator");
}

function normalizeProjectKey(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function tokenize(input: string) {
  return input
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 3);
}

function stripHtml(html: string) {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<noscript[\s\S]*?<\/noscript>/gi, " ")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/\s+/g, " ")
    .trim();
}

async function safeReadFile(filePath: string) {
  try {
    const stat = await fs.stat(filePath);
    if (!stat.isFile() || stat.size > 250_000) return "";
    return await fs.readFile(filePath, "utf8");
  } catch {
    return "";
  }
}

async function collectTextFiles(dirPath: string, depth = 0, output: string[] = []) {
  if (depth > 3 || output.length >= 25) return output;

  let entries: import("node:fs").Dirent[] = [];
  try {
    entries = await fs.readdir(dirPath, { withFileTypes: true });
  } catch {
    return output;
  }

  for (const entry of entries) {
    if (output.length >= 25) break;
    const fullPath = path.join(dirPath, entry.name);
    if (entry.isDirectory()) {
      if (["node_modules", ".git", "dist", "build", ".next"].includes(entry.name)) continue;
      await collectTextFiles(fullPath, depth + 1, output);
      continue;
    }
    if (!entry.isFile()) continue;

    const ext = path.extname(entry.name).toLowerCase();
    if (![".txt", ".md", ".markdown"].includes(ext)) continue;
    output.push(fullPath);
  }

  return output;
}

async function loadLocalSource(sourcePath: string) {
  const resolved = path.isAbsolute(sourcePath)
    ? sourcePath
    : path.resolve(process.cwd(), sourcePath);

  try {
    const stat = await fs.stat(resolved);
    if (stat.isFile()) {
      return await safeReadFile(resolved);
    }
    if (!stat.isDirectory()) return "";

    const files = await collectTextFiles(resolved);
    const chunks: string[] = [];
    for (const filePath of files) {
      const content = await safeReadFile(filePath);
      if (!content.trim()) continue;
      chunks.push(`[source:${filePath}]\n${content.slice(0, 12_000)}`);
    }
    return chunks.join("\n\n");
  } catch {
    return "";
  }
}

async function fetchRemoteSource(url: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetch(url, {
      method: "GET",
      redirect: "follow",
      signal: controller.signal,
      headers: {
        "user-agent": "luxisoft-whatsapp-agent/2.0"
      }
    });
    if (!response.ok) return "";

    const raw = await response.text().catch(() => "");
    if (!raw) return "";
    const normalized = stripHtml(raw);
    if (!normalized) return "";
    return `[source:${url}]\n${normalized.slice(0, 16_000)}`;
  } catch {
    return "";
  } finally {
    clearTimeout(timeout);
  }
}

function resolveSources(projectKey: string) {
  const configured = env.agentProjectSources[projectKey] ?? [];
  const fallback = DEFAULT_PROJECT_SOURCES[projectKey] ?? [];
  return Array.from(new Set([...configured, ...fallback])).filter(Boolean);
}

async function loadProjectKnowledge(projectKey: string) {
  const now = Date.now();
  const cached = knowledgeCache.get(projectKey);
  if (cached && now - cached.loadedAt <= KNOWLEDGE_CACHE_TTL_MS) {
    return cached.text;
  }

  const agentsDir = resolveAgentsDir();
  const pieces: string[] = [];
  const project = await loadProjectAgent(agentsDir, projectKey);
  if (project?.prompt?.trim()) {
    pieces.push(`[project_prompt:${projectKey}]\n${project.prompt.trim()}`);
  }

  const sources = resolveSources(projectKey);
  for (const source of sources) {
    if (/^https?:\/\//i.test(source)) {
      const loaded = await fetchRemoteSource(source);
      if (loaded) pieces.push(loaded);
      continue;
    }
    const loaded = await loadLocalSource(source);
    if (loaded) pieces.push(loaded);
  }

  const knowledge = pieces.join("\n\n").trim();
  knowledgeCache.set(projectKey, { loadedAt: now, text: knowledge });
  return knowledge;
}

function pickRelevantSnippets(knowledge: string, question: string) {
  if (!knowledge.trim()) return [] as string[];

  const queryTokens = new Set(tokenize(question));
  if (!queryTokens.size) return [] as string[];

  const paragraphs = knowledge
    .split(/\n{2,}/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 40)
    .slice(0, 500);

  return paragraphs
    .map((paragraph) => {
      const tokenHits = tokenize(paragraph).reduce((acc, token) => (queryTokens.has(token) ? acc + 1 : acc), 0);
      return {
        paragraph,
        score: tokenHits
      };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.paragraph.length - a.paragraph.length;
    })
    .slice(0, 4)
    .map((item) => item.paragraph.slice(0, 320));
}

async function searchKnowledge(projectKey: string, query: string) {
  const knowledge = await loadProjectKnowledge(projectKey);
  return pickRelevantSnippets(knowledge, query);
}

function parseJsonObject(value: unknown) {
  if (typeof value !== "string" || !value.trim()) return {} as Record<string, unknown>;
  try {
    const parsed = JSON.parse(value);
    return isRecord(parsed) ? parsed : ({} as Record<string, unknown>);
  } catch {
    return {} as Record<string, unknown>;
  }
}

function getOpenAIClient() {
  if (!env.openaiApiKey) {
    throw new Error("openai_not_configured");
  }
  if (!openaiClient) {
    openaiClient = new OpenAI({
      apiKey: env.openaiApiKey,
      ...(env.openaiBaseUrl ? { baseURL: env.openaiBaseUrl } : {})
    });
  }
  return openaiClient;
}

function extractResponseText(response: any) {
  if (typeof response?.output_text === "string" && response.output_text.trim()) {
    return response.output_text.trim();
  }

  const output = Array.isArray(response?.output) ? response.output : [];
  const chunks: string[] = [];
  for (const item of output) {
    if (item?.type !== "message") continue;
    const content = Array.isArray(item?.content) ? item.content : [];
    for (const part of content) {
      if (part?.type === "output_text" && typeof part.text === "string") {
        chunks.push(part.text);
      } else if (part?.type === "text" && typeof part.text === "string") {
        chunks.push(part.text);
      }
    }
  }

  return chunks.join("\n").trim();
}

function listFunctionCalls(response: any) {
  const output = Array.isArray(response?.output) ? response.output : [];
  return output.filter((item: any) => item?.type === "function_call");
}

function detectProjectByText(text: string) {
  const normalized = text.toLowerCase();
  if (/(^|\s|\b)(navai)(\b|\s|$)/i.test(normalized)) return "navai";
  if (/(^|\s|\b)(luxichat|audeo)(\b|\s|$)/i.test(normalized)) return "luxichat";
  if (/(^|\s|\b)(luxisoft)(\b|\s|$)/i.test(normalized)) return "luxisoft";

  const command = normalized.match(/(?:proyecto|project)\s*[:=\-]?\s*([a-z0-9_-]{2,64})/i)?.[1] ?? null;
  if (!command) return null;
  return normalizeProjectKey(command) || null;
}

function buildHistoryBlock(history: ConversationState["history"]) {
  return history
    .slice(-8)
    .map((item) => `${item.role === "user" ? "Usuario" : "Asistente"}: ${item.text}`)
    .join("\n");
}

function getConversation(phoneE164: string, projectKey: string) {
  const existing = conversations.get(phoneE164);
  if (existing) {
    if (projectKey) existing.projectKey = projectKey;
    return existing;
  }

  const initial: ConversationState = {
    projectKey,
    history: []
  };
  conversations.set(phoneE164, initial);
  return initial;
}

function appendHistory(state: ConversationState, role: "user" | "assistant", text: string) {
  state.history.push({ role, text, at: Date.now() });
  if (state.history.length > MAX_HISTORY_ITEMS) {
    state.history = state.history.slice(-MAX_HISTORY_ITEMS);
  }
}

async function runProjectAgent(input: {
  projectKey: string;
  phoneE164: string;
  userMessage: string;
  history: ConversationState["history"];
  objective?: string;
}) {
  const agentsDir = resolveAgentsDir();
  const preferredProjectKey = normalizeProjectKey(input.projectKey) || env.defaultProject;
  const project =
    (await loadProjectAgent(agentsDir, preferredProjectKey)) ??
    (await loadProjectAgent(agentsDir, env.defaultProject));

  if (!project) {
    return {
      projectKey: env.defaultProject,
      answer: "No hay agente de proyecto configurado en el servidor.",
      toolsUsed: [] as string[]
    };
  }

  const runtimeContext: AgentScriptRuntimeContext = {
    projectKey: project.project_key,
    phoneE164: input.phoneE164,
    userMessage: input.userMessage,
    history: input.history.map((item) => ({ role: item.role, text: item.text })),
    sources: resolveSources(project.project_key),
    searchKnowledge: (query) => searchKnowledge(project.project_key, query)
  };

  const scriptMap = new Map(project.scripts.map((script) => [script.name, script]));
  const tools = project.scripts.map((script) => ({
    type: "function",
    name: script.name,
    description: script.description,
    parameters: script.parameters,
    strict: false
  }));

  const model = env.openaiProjectModel;
  const client = getOpenAIClient();
  const toolsUsed = new Set<string>();

  const systemPrompt = [
    project.prompt || `Eres el agente del proyecto ${project.project_key}.`,
    "Responde en espanol claro, maximo 6 lineas si no requiere mas detalle.",
    "Si necesitas datos concretos del proyecto, usa los tools disponibles antes de responder.",
    'Siempre invita a escalar con la frase exacta: "Si quieres, te paso con un agente humano."'
  ].join("\n\n");

  const userPrompt = [
    `Proyecto: ${project.project_key}`,
    input.objective ? `Objetivo del orquestador: ${input.objective}` : "",
    `Historial reciente:`,
    buildHistoryBlock(input.history) || "Sin historial.",
    "",
    `Mensaje actual del usuario:`,
    input.userMessage
  ]
    .filter(Boolean)
    .join("\n");

  let response: any = await client.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    ...(tools.length ? { tools } : {})
  } as any);

  for (let step = 0; step < env.openaiAgentMaxToolSteps; step += 1) {
    const calls = listFunctionCalls(response);
    if (!calls.length) break;

    const toolOutputs = [] as Array<{ type: "function_call_output"; call_id: string; output: string }>;
    for (const call of calls) {
      const toolName = String(call?.name ?? "").trim();
      const callId = String(call?.call_id ?? call?.id ?? "");
      if (!toolName || !callId) continue;
      toolsUsed.add(toolName);

      const script = scriptMap.get(toolName);
      if (!script) {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ ok: false, error: "tool_not_found" })
        });
        continue;
      }

      const args = parseJsonObject(call?.arguments);
      try {
        const result = await script.run(args, runtimeContext);
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({ ok: true, result: result ?? {} })
        });
      } catch (err: any) {
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            ok: false,
            error: String(err?.message ?? "tool_execution_failed")
          })
        });
      }
    }

    if (!toolOutputs.length) break;

    response = await client.responses.create({
      model,
      previous_response_id: response.id,
      input: toolOutputs,
      ...(tools.length ? { tools } : {})
    } as any);
  }

  const answer = extractResponseText(response) || "No pude generar respuesta en este momento.";
  return {
    projectKey: project.project_key,
    answer: answer.slice(0, MAX_RESPONSE_CHARS),
    toolsUsed: Array.from(toolsUsed)
  };
}

function isDirectChild(parentDir: string, childDir: string) {
  const parent = path.resolve(parentDir);
  const childParent = path.dirname(path.resolve(childDir));
  return parent === childParent;
}

async function transferToHuman(input: {
  projectKey: string;
  phoneE164: string;
  summary: string;
}) {
  const transferTarget = env.humanTransferNumber;
  if (!transferTarget) {
    return {
      ok: false,
      sent: false,
      error: "human_transfer_number_not_configured"
    };
  }

  const payload = [
    "[Bridge -> humano] Transferencia solicitada",
    `Proyecto: ${input.projectKey}`,
    `Usuario: ${input.phoneE164}`,
    "Resumen:",
    input.summary || "Sin resumen."
  ].join("\n");

  try {
    await sendWhatsappText(transferTarget, payload);
    return { ok: true, sent: true };
  } catch (err: any) {
    return {
      ok: false,
      sent: false,
      error: String(err?.message ?? "human_transfer_failed")
    };
  }
}

async function runOrchestrator(input: {
  phoneE164: string;
  message: string;
  state: ConversationState;
  preferredProjectKey: string;
}) {
  const agentsDir = resolveAgentsDir();
  const orchestratorDir = resolveOrchestratorDir();
  const orchestrator = await loadOrchestratorAgent(orchestratorDir);
  const excluded = isDirectChild(agentsDir, orchestratorDir) ? [orchestrator.project_key] : [];
  const availableProjects = await listProjectKeys(agentsDir, excluded);

  const client = getOpenAIClient();
  const model = env.openaiOrchestratorModel;

  let selectedProject = normalizeProjectKey(input.preferredProjectKey) || env.defaultProject;
  let escalated = false;
  let escalationSent = false;
  let lastDelegatedReply = "";

  const tools = [
    {
      type: "function",
      name: "delegate_project_agent",
      description: "Delega la respuesta al agente especializado de un proyecto.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          project_key: {
            type: "string",
            description: "Proyecto destino. Debe ser uno de los disponibles."
          },
          user_message: {
            type: "string",
            description: "Mensaje del usuario para procesar."
          },
          objective: {
            type: "string",
            description: "Objetivo puntual para el subagente."
          }
        },
        required: ["user_message"],
        additionalProperties: false
      }
    },
    {
      type: "function",
      name: "transfer_to_human",
      description: "Escala el caso a un humano y envia resumen por WhatsApp.",
      strict: false,
      parameters: {
        type: "object",
        properties: {
          project_key: {
            type: "string"
          },
          summary: {
            type: "string",
            description: "Resumen breve y accionable de la solicitud del usuario."
          }
        },
        required: ["summary"],
        additionalProperties: false
      }
    }
  ];

  const systemPrompt = [
    orchestrator.prompt ||
      "Eres el agente orquestador. Delega a agentes de proyecto y entrega respuesta final al usuario.",
    "Siempre responde en espanol.",
    "Para consultas de negocio/servicios/productos debes usar delegate_project_agent.",
    "Si el usuario pide humano, usa transfer_to_human y confirma el estado.",
    "No inventes informacion tecnica no confirmada por subagente."
  ].join("\n\n");

  const userPrompt = [
    `Telefono: ${input.phoneE164}`,
    `Proyecto preferido: ${selectedProject}`,
    `Proyectos disponibles: ${availableProjects.join(", ") || "ninguno"}`,
    "Historial reciente:",
    buildHistoryBlock(input.state.history) || "Sin historial.",
    "",
    "Mensaje actual del usuario:",
    input.message
  ].join("\n");

  let response: any = await client.responses.create({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    tools
  } as any);

  for (let step = 0; step < env.openaiAgentMaxToolSteps; step += 1) {
    const calls = listFunctionCalls(response);
    if (!calls.length) break;

    const toolOutputs = [] as Array<{ type: "function_call_output"; call_id: string; output: string }>;
    for (const call of calls) {
      const toolName = String(call?.name ?? "").trim();
      const callId = String(call?.call_id ?? call?.id ?? "");
      if (!toolName || !callId) continue;
      const args = parseJsonObject(call?.arguments);

      if (toolName === "delegate_project_agent") {
        const requestedProject = normalizeProjectKey(String(args.project_key ?? "")) || selectedProject;
        const delegated = await runProjectAgent({
          projectKey: requestedProject,
          phoneE164: input.phoneE164,
          userMessage: String(args.user_message ?? input.message),
          objective: String(args.objective ?? "").trim() || undefined,
          history: input.state.history
        });
        selectedProject = delegated.projectKey;
        lastDelegatedReply = delegated.answer;
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify({
            ok: true,
            project_key: delegated.projectKey,
            tools_used: delegated.toolsUsed,
            reply: delegated.answer
          })
        });
        continue;
      }

      if (toolName === "transfer_to_human") {
        escalated = true;
        const requestedProject = normalizeProjectKey(String(args.project_key ?? "")) || selectedProject;
        const summary = String(args.summary ?? "").trim();
        const transfer = await transferToHuman({
          projectKey: requestedProject,
          phoneE164: input.phoneE164,
          summary
        });
        escalationSent = escalationSent || transfer.sent;
        toolOutputs.push({
          type: "function_call_output",
          call_id: callId,
          output: JSON.stringify(transfer)
        });
        continue;
      }

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ ok: false, error: "tool_not_supported" })
      });
    }

    if (!toolOutputs.length) break;

    response = await client.responses.create({
      model,
      previous_response_id: response.id,
      input: toolOutputs,
      tools
    } as any);
  }

  const fallback = lastDelegatedReply || "No pude procesar tu solicitud en este momento.";
  const reply = (extractResponseText(response) || fallback).slice(0, MAX_RESPONSE_CHARS);

  return {
    projectKey: selectedProject,
    reply,
    escalated,
    escalationSent
  };
}

export async function handleProjectAgentMessage(input: {
  phoneE164: string;
  text: string;
}): Promise<AgentReply> {
  const phone = normalizeE164(input.phoneE164);
  const message = String(input.text ?? "").trim();

  if (!phone || !message) {
    return {
      handled: false,
      projectKey: env.defaultProject,
      reply: "",
      escalated: false,
      escalationSent: false
    };
  }

  if (!env.openaiApiKey) {
    return {
      handled: true,
      projectKey: env.defaultProject,
      reply: "Agentes OpenAI no configurados. Falta OPENAI_API_KEY en el servidor.",
      escalated: false,
      escalationSent: false
    };
  }

  const explicitProject = detectProjectByText(message);
  const previous = conversations.get(phone);
  const projectKey = explicitProject ?? previous?.projectKey ?? env.defaultProject;
  const state = getConversation(phone, projectKey);
  appendHistory(state, "user", message);

  try {
    const orchestrated = await runOrchestrator({
      phoneE164: phone,
      message,
      state,
      preferredProjectKey: projectKey
    });

    state.projectKey = orchestrated.projectKey;
    appendHistory(state, "assistant", orchestrated.reply);

    return {
      handled: true,
      projectKey: orchestrated.projectKey,
      reply: orchestrated.reply,
      escalated: orchestrated.escalated,
      escalationSent: orchestrated.escalationSent
    };
  } catch (err: any) {
    const fallback = `No pude responder por el momento (${String(err?.message ?? "agent_failed")}).`;
    appendHistory(state, "assistant", fallback);
    return {
      handled: true,
      projectKey: state.projectKey,
      reply: fallback,
      escalated: false,
      escalationSent: false
    };
  }
}
