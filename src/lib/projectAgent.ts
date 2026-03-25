import path from "node:path";
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

type LeadProfile = {
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  email: string | null;
  need: string | null;
};

type ConversationState = {
  projectKey: string;
  projectConfirmed: boolean;
  history: Array<{ role: "user" | "assistant"; text: string; at: number }>;
  lead: LeadProfile;
  awaitingHumanTransferData: boolean;
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
const MAX_SOURCE_LINKS_PER_PAGE = 20;
const MAX_GROUNDING_SNIPPETS = 6;
const MAX_CRAWL_PAGES_PER_SOURCE = 6;
const MAX_CRAWL_DEPTH = 1;
const MAX_PAGE_TEXT_CHARS = 10_000;

const DEFAULT_PROJECT_SOURCES: Record<string, string[]> = {
  luxisoft: ["https://luxisoft.com/en/"],
  navai: ["https://navai.luxisoft.com/",],
  luxichat: ["https://luxichat.com/"]
};

const PROJECT_OFFERS: Record<string, string> = {
  luxisoft: "LuxiSoft",
  navai: "NAVAI",
  luxichat: "LuxiChat"
};

const SUPPORT_KEYWORDS = [
  "soporte",
  "problema",
  "error",
  "falla",
  "incidencia",
  "ayuda tecnica",
  "no funciona"
];

const BUY_KEYWORDS = [
  "comprar",
  "adquirir",
  "contratar",
  "cotizacion",
  "cotizar",
  "precio",
  "plan",
  "servicio",
  "producto"
];

const HUMAN_KEYWORDS = [
  "agente humano",
  "asesor humano",
  "humano",
  "ejecutivo",
  "representante",
  "persona real"
];

const OUTSIDE_KEYWORDS = [
  "otro servicio",
  "otra cosa",
  "diferente",
  "ninguno",
  "ninguna",
  "no aplica",
  "no es eso"
];

const LEAD_REQUIRED_FIELDS: Array<keyof LeadProfile> = [
  "firstName",
  "lastName",
  "company",
  "email",
  "need"
];

const LEAD_FIELD_QUESTIONS: Record<keyof LeadProfile, string> = {
  firstName: "Por favor indicame tus nombres.",
  lastName: "Ahora indicame tus apellidos.",
  company: "Cual es tu empresa?",
  email: "Cual es tu correo de contacto?",
  need: "Que necesitas exactamente o que quieres resolver?"
};

type RoutingDecision =
  | { kind: "support_project"; projectKey: string }
  | { kind: "support_project_unknown" }
  | { kind: "sales_project"; projectKey: string }
  | { kind: "sales_offer_catalog" }
  | { kind: "outside_transfer" }
  | { kind: "human_scope_check" }
  | { kind: "general" };

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

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function emptyLeadProfile(): LeadProfile {
  return {
    firstName: null,
    lastName: null,
    company: null,
    email: null,
    need: null
  };
}

function sanitizeValue(value: string | null | undefined, maxLength = 120) {
  const normalized = String(value ?? "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized) return null;
  return normalized.slice(0, maxLength);
}

function titleCase(value: string | null | undefined) {
  const normalized = sanitizeValue(value);
  if (!normalized) return null;
  return normalized
    .split(" ")
    .filter(Boolean)
    .map((item) => item[0].toUpperCase() + item.slice(1).toLowerCase())
    .join(" ");
}

function ensureKnownProjectKey(value: string | null | undefined) {
  const normalized = normalizeProjectKey(value);
  if (!normalized) return null;
  return Object.prototype.hasOwnProperty.call(PROJECT_OFFERS, normalized) ? normalized : null;
}

function containsKeyword(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function extractEmail(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function updateLeadProfileFromMessage(profile: LeadProfile, message: string): LeadProfile {
  const next: LeadProfile = { ...profile };
  const text = String(message ?? "");

  const email = extractEmail(text);
  if (email) next.email = email;

  const fullName = text.match(
    /(?:mi nombre es|me llamo|soy)\s+([A-Za-z\u00C0-\u017F]+)\s+([A-Za-z\u00C0-\u017F]+)(?:\s+([A-Za-z\u00C0-\u017F]+))?/i
  );
  if (fullName) {
    if (!next.firstName) next.firstName = titleCase(fullName[1]);
    if (!next.lastName) next.lastName = titleCase(fullName[2]);
  }

  const firstNameField = text.match(/(?:nombres?|nombre)\s*[:\-]\s*([^\n,.;]+)/i);
  if (firstNameField?.[1]) {
    next.firstName = titleCase(firstNameField[1]);
  }

  const lastNameField = text.match(/(?:apellidos?)\s*[:\-]\s*([^\n,.;]+)/i);
  if (lastNameField?.[1]) {
    next.lastName = titleCase(lastNameField[1]);
  }

  const companyField = text.match(
    /(?:empresa|compa(?:n|\u00F1)i(?:a|as)|organizacion|organizaci\u00F3n|trabajo en|represento a)\s*[:\-]?\s*([^\n,.;]+)/i
  );
  if (companyField?.[1]) {
    next.company = sanitizeValue(companyField[1], 140);
  }

  const needField = text.match(/(?:necesito|quiero|busco|requiero|me interesa)\s+([^.!?\n]+)/i);
  if (needField?.[1]) {
    next.need = sanitizeValue(needField[1], 220);
  }

  return next;
}

function getMissingLeadFields(profile: LeadProfile) {
  return LEAD_REQUIRED_FIELDS.filter((field) => !sanitizeValue(profile[field], 220));
}

function firstOfficialSource(projectKey: string) {
  return resolveWebSources(projectKey)[0] ?? "sin fuente web oficial configurada";
}

function formatCatalogOfferMessage() {
  return [
    "Puedo ayudarte con informacion oficial de estas aplicaciones/servicios:",
    `- ${PROJECT_OFFERS.luxisoft}: ${firstOfficialSource("luxisoft")}`,
    `- ${PROJECT_OFFERS.navai}: ${firstOfficialSource("navai")}`,
    `- ${PROJECT_OFFERS.luxichat}: ${firstOfficialSource("luxichat")}`,
    "Dime cual te interesa y te conecto con el especialista para avanzar.",
    "Si necesitas algo diferente, tambien te puedo transferir con un agente humano."
  ].join("\n");
}

function buildLeadCollectionPrompt(profile: LeadProfile, firstInteraction: boolean) {
  const missing = getMissingLeadFields(profile);
  const nextField = missing[0];
  if (!nextField) return null;

  if (firstInteraction) {
    return [
      "Para transferirte con un agente humano necesito registrar estos datos:",
      "- nombres",
      "- apellidos",
      "- empresa",
      "- correo",
      "- necesidad puntual",
      LEAD_FIELD_QUESTIONS[nextField]
    ].join("\n");
  }

  return LEAD_FIELD_QUESTIONS[nextField];
}

function classifyRouting(message: string, state: ConversationState): RoutingDecision {
  const support = containsKeyword(message, SUPPORT_KEYWORDS);
  const buy = containsKeyword(message, BUY_KEYWORDS);
  const human = containsKeyword(message, HUMAN_KEYWORDS);
  const outside = containsKeyword(message, OUTSIDE_KEYWORDS);

  const mentionedProject = ensureKnownProjectKey(detectProjectByText(message));
  const currentProject = ensureKnownProjectKey(state.projectKey);
  const contextProject = state.projectConfirmed ? currentProject : null;

  if (support) {
    const target = mentionedProject ?? contextProject;
    if (target) return { kind: "support_project", projectKey: target };
    return { kind: "support_project_unknown" };
  }

  if (buy) {
    const target = mentionedProject ?? contextProject;
    if (target) return { kind: "sales_project", projectKey: target };
    if (outside) return { kind: "outside_transfer" };
    return { kind: "sales_offer_catalog" };
  }

  if (human) {
    if (outside) return { kind: "outside_transfer" };
    return { kind: "human_scope_check" };
  }

  return { kind: "general" };
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

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">");
}

function normalizeHttpUrl(urlLike: string, baseUrl: string) {
  try {
    const normalized = new URL(urlLike, baseUrl).toString();
    return /^https?:\/\//i.test(normalized) ? normalized : null;
  } catch {
    return null;
  }
}

function normalizeHost(host: string) {
  return host.toLowerCase().replace(/^www\./, "");
}

function isSameDomain(left: string, right: string) {
  return normalizeHost(left) === normalizeHost(right);
}

function normalizeComparableUrl(value: string) {
  try {
    const parsed = new URL(value);
    parsed.hash = "";
    return parsed.toString();
  } catch {
    return value;
  }
}

function extractAbsoluteAnchorLinks(rawHtml: string, sourceUrl: string) {
  const links: Array<{ href: string; label: string | null }> = [];
  const unique = new Set<string>();
  const anchorRegex = /<a\b[^>]*href\s*=\s*["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi;

  for (const match of rawHtml.matchAll(anchorRegex)) {
    const rawHref = String(match[1] ?? "").trim();
    if (!rawHref) continue;
    if (/^(#|javascript:|mailto:|tel:)/i.test(rawHref)) continue;

    const href = normalizeHttpUrl(rawHref, sourceUrl);
    if (!href || unique.has(href)) continue;
    unique.add(href);

    const label = decodeHtmlEntities(stripHtml(String(match[2] ?? ""))).trim();
    links.push({ href, label: label || null });
  }

  return links;
}

function extractSourceLinks(rawHtml: string, sourceUrl: string) {
  const links: string[] = [];
  for (const item of extractAbsoluteAnchorLinks(rawHtml, sourceUrl)) {
    links.push(item.label ? `${item.label}: ${item.href}` : item.href);

    if (links.length >= MAX_SOURCE_LINKS_PER_PAGE) break;
  }

  return links;
}

function shouldCrawlSublink(candidateUrl: string, rootUrl: string) {
  try {
    const candidate = new URL(candidateUrl);
    const root = new URL(rootUrl);
    if (!isSameDomain(candidate.host, root.host)) return false;

    const path = candidate.pathname.toLowerCase();
    if (
      /\.(pdf|png|jpg|jpeg|gif|webp|svg|zip|rar|7z|mp4|mp3|avi|mov|woff2?|ttf)$/i.test(path)
    ) {
      return false;
    }

    return true;
  } catch {
    return false;
  }
}

async function fetchRemotePage(url: string) {
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
    if (!response.ok) return null;

    const raw = await response.text().catch(() => "");
    if (!raw) return null;
    const sourceUrl = response.url || url;
    const normalized = stripHtml(raw);
    if (!normalized) return null;

    return {
      sourceUrl,
      raw,
      text: normalized
    };
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchRemoteSource(url: string) {
  const queue: Array<{ url: string; depth: number }> = [{ url, depth: 0 }];
  const visited = new Set<string>();
  const sections: string[] = [];

  while (queue.length > 0 && visited.size < MAX_CRAWL_PAGES_PER_SOURCE) {
    const current = queue.shift()!;
    const comparableCurrent = normalizeComparableUrl(current.url);
    if (visited.has(comparableCurrent)) continue;
    visited.add(comparableCurrent);

    const page = await fetchRemotePage(current.url);
    if (!page) continue;

    sections.push(`[source:${page.sourceUrl}]`);
    sections.push(page.text.slice(0, MAX_PAGE_TEXT_CHARS));

    const links = extractSourceLinks(page.raw, page.sourceUrl);
    if (links.length) {
      sections.push(`[source_links:${page.sourceUrl}]`);
      sections.push(...links.map((item) => `- ${item}`));
    }

    if (current.depth >= MAX_CRAWL_DEPTH) continue;

    const candidates = extractAbsoluteAnchorLinks(page.raw, page.sourceUrl)
      .map((item) => item.href)
      .filter((href) => shouldCrawlSublink(href, url))
      .slice(0, MAX_SOURCE_LINKS_PER_PAGE);

    for (const candidate of candidates) {
      const comparable = normalizeComparableUrl(candidate);
      if (visited.has(comparable)) continue;
      if (queue.some((item) => normalizeComparableUrl(item.url) === comparable)) continue;
      queue.push({ url: candidate, depth: current.depth + 1 });
    }
  }

  return sections.join("\n");
}

function resolveSources(projectKey: string) {
  const configured = env.agentProjectSources[projectKey] ?? [];
  const fallback = DEFAULT_PROJECT_SOURCES[projectKey] ?? [];
  return Array.from(new Set([...configured, ...fallback])).filter(Boolean);
}

function resolveWebSources(projectKey: string) {
  return resolveSources(projectKey).filter((source) => /^https?:\/\//i.test(source));
}

async function loadProjectKnowledge(projectKey: string) {
  const now = Date.now();
  const cached = knowledgeCache.get(projectKey);
  if (cached && now - cached.loadedAt <= KNOWLEDGE_CACHE_TTL_MS) {
    return cached.text;
  }

  const pieces: string[] = [];
  const sources = resolveWebSources(projectKey);
  for (const source of sources) {
    const loaded = await fetchRemoteSource(source);
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

function buildGroundingBlock(snippets: string[]) {
  return snippets
    .slice(0, MAX_GROUNDING_SNIPPETS)
    .map((snippet, index) => `[${index + 1}] ${snippet}`)
    .join("\n");
}

function buildNoGroundingReply(projectKey: string) {
  const sources = resolveWebSources(projectKey);
  const lines = [
    `Revise las paginas oficiales de ${projectKey} y ese punto exacto no aparece publicado por ahora.`
  ];

  if (sources.length) {
    lines.push("Fuentes oficiales revisadas:");
    lines.push(...sources.slice(0, 3));
  }

  lines.push("Si quieres, te propongo el siguiente paso comercial o te paso con un agente humano.");
  return lines.join("\n");
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

function resolveOpenAIBaseUrl() {
  const base = env.openaiBaseUrl.trim() || "https://api.openai.com/v1";
  return base.replace(/\/+$/, "");
}

async function openaiResponsesCreate(payload: Record<string, unknown>) {
  if (!env.openaiApiKey) {
    throw new Error("openai_not_configured");
  }

  const response = await fetch(`${resolveOpenAIBaseUrl()}/responses`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${env.openaiApiKey}`,
      "content-type": "application/json"
    },
    body: JSON.stringify(payload)
  });

  const raw = await response.text().catch(() => "");
  let parsed: any = {};
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      parsed = { raw };
    }
  }

  if (!response.ok) {
    throw Object.assign(new Error("openai_responses_failed"), {
      statusCode: response.status,
      details: parsed
    });
  }

  return parsed;
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

function buildHumanSummary(state: ConversationState) {
  const recentUserMessages = state.history
    .filter((item) => item.role === "user")
    .slice(-4)
    .map((item) => `- ${item.text.slice(0, 220)}`)
    .join("\n");

  return [
    `Nombre: ${state.lead.firstName ?? "(sin dato)"} ${state.lead.lastName ?? ""}`.trim(),
    `Empresa: ${state.lead.company ?? "(sin dato)"}`,
    `Correo: ${state.lead.email ?? "(sin dato)"}`,
    `Necesidad: ${state.lead.need ?? "(sin dato)"}`,
    "Mensajes recientes del usuario:",
    recentUserMessages || "- Sin mensajes."
  ].join("\n");
}

function getConversation(phoneE164: string, projectKey: string) {
  const existing = conversations.get(phoneE164);
  if (existing) {
    if (projectKey) existing.projectKey = projectKey;
    return existing;
  }

  const initial: ConversationState = {
    projectKey,
    projectConfirmed: false,
    history: [],
    lead: emptyLeadProfile(),
    awaitingHumanTransferData: false
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

  const groundingQuery = [input.objective ?? "", input.userMessage]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(". ");
  const groundingSnippets = await searchKnowledge(
    project.project_key,
    groundingQuery || input.userMessage
  );

  if (!groundingSnippets.length) {
    return {
      projectKey: project.project_key,
      answer: buildNoGroundingReply(project.project_key),
      toolsUsed: [] as string[]
    };
  }

  const runtimeContext: AgentScriptRuntimeContext = {
    projectKey: project.project_key,
    phoneE164: input.phoneE164,
    userMessage: input.userMessage,
    history: input.history.map((item) => ({ role: item.role, text: item.text })),
    sources: resolveWebSources(project.project_key),
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
  const toolsUsed = new Set<string>();

  const systemPrompt = [
    project.prompt || `Eres el agente del proyecto ${project.project_key}.`,
    "Responde en espanol claro, maximo 6 lineas si no requiere mas detalle.",
    "Responde exclusivamente con informacion presente en BLOQUE_DE_FUENTES_CONFIRMADAS.",
    "No uses conocimiento externo ni inventes datos no confirmados por fuentes oficiales.",
    "Si un dato no aparece en fuentes, responde con tono comercial seguro: explica lo que si esta publicado y el siguiente paso.",
    "Evita tono de inseguridad o frases ambiguas; habla con claridad.",
    "Si necesitas mas contexto del sitio, usa los tools disponibles antes de responder.",
    "Cuando compartas enlaces, usa URL completa para previsualizacion en WhatsApp.",
    'Siempre invita a escalar con la frase exacta: "Si quieres, te paso con un agente humano."'
  ].join("\n\n");

  const userPrompt = [
    `Proyecto: ${project.project_key}`,
    input.objective ? `Objetivo del orquestador: ${input.objective}` : "",
    "BLOQUE_DE_FUENTES_CONFIRMADAS:",
    buildGroundingBlock(groundingSnippets),
    `Historial reciente:`,
    buildHistoryBlock(input.history) || "Sin historial.",
    "",
    `Mensaje actual del usuario:`,
    input.userMessage
  ]
    .filter(Boolean)
    .join("\n");

  let response: any = await openaiResponsesCreate({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    ...(tools.length ? { tools } : {})
  });

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

    response = await openaiResponsesCreate({
      model,
      previous_response_id: response.id,
      input: toolOutputs,
      ...(tools.length ? { tools } : {})
    });
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
    `Proyecto sugerido: ${input.projectKey}`,
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

  const model = env.openaiOrchestratorModel;

  let selectedProject = normalizeProjectKey(input.preferredProjectKey) || env.defaultProject;
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
    }
  ];

  const systemPrompt = [
    orchestrator.prompt ||
      "Eres el agente orquestador. Delega a agentes de proyecto y entrega respuesta final al usuario.",
    "Siempre responde en espanol.",
    "Para consultas de negocio/servicios/productos debes usar delegate_project_agent.",
    "No agregues datos tecnicos/comerciales que no vengan del subagente.",
    "Tu respuesta final debe basarse solo en informacion confirmada por el subagente.",
    "No llames transferencia humana desde este flujo; la transferencia se gestiona por validacion previa del sistema.",
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

  let response: any = await openaiResponsesCreate({
    model,
    input: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ],
    tools
  });

  for (let step = 0; step < env.openaiAgentMaxToolSteps; step += 1) {
    const calls = listFunctionCalls(response);
    if (!calls.length) break;

    const toolOutputs = [] as Array<{ type: "function_call_output"; call_id: string; output: string }>;
    for (const call of calls) {
      const toolName = String(call?.name ?? "").trim();
      const callId = String(call?.call_id ?? call?.id ?? "");
      if (!toolName || !callId) continue;

      if (toolName === "delegate_project_agent") {
        const args = parseJsonObject(call?.arguments);
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

      toolOutputs.push({
        type: "function_call_output",
        call_id: callId,
        output: JSON.stringify({ ok: false, error: "tool_not_supported" })
      });
    }

    if (!toolOutputs.length) break;

    response = await openaiResponsesCreate({
      model,
      previous_response_id: response.id,
      input: toolOutputs,
      tools
    });
  }

  const fallback = lastDelegatedReply || "No pude procesar tu solicitud en este momento.";
  const reply = (extractResponseText(response) || fallback).slice(0, MAX_RESPONSE_CHARS);

  return {
    projectKey: selectedProject,
    reply,
    escalated: false,
    escalationSent: false
  };
}

async function runHumanTransferQualification(input: {
  state: ConversationState;
  phoneE164: string;
  firstInteraction: boolean;
}) {
  const missing = getMissingLeadFields(input.state.lead);
  if (missing.length > 0) {
    const prompt = buildLeadCollectionPrompt(input.state.lead, input.firstInteraction);
    const reply = prompt ?? "Necesito un dato adicional para continuar con la transferencia.";
    appendHistory(input.state, "assistant", reply);
    return {
      handled: true,
      projectKey: input.state.projectKey,
      reply,
      escalated: true,
      escalationSent: false
    } as AgentReply;
  }

  const transfer = await transferToHuman({
    projectKey: input.state.projectKey,
    phoneE164: input.phoneE164,
    summary: buildHumanSummary(input.state)
  });
  input.state.awaitingHumanTransferData = false;

  const reply = transfer.sent
    ? "Perfecto, ya transferi tu caso a un agente humano con tus datos y resumen. Te contactaran pronto."
    : "Intente transferir tu caso a un agente humano, pero fallo el envio en este momento. Intenta de nuevo en unos minutos.";
  appendHistory(input.state, "assistant", reply);

  return {
    handled: true,
    projectKey: input.state.projectKey,
    reply,
    escalated: true,
    escalationSent: transfer.sent
  } as AgentReply;
}

async function runProjectRedirect(input: {
  state: ConversationState;
  phoneE164: string;
  message: string;
  projectKey: string;
  objective: string;
}) {
  const delegated = await runProjectAgent({
    projectKey: input.projectKey,
    phoneE164: input.phoneE164,
    userMessage: input.message,
    objective: input.objective,
    history: input.state.history
  });
  input.state.projectKey = delegated.projectKey;
  input.state.projectConfirmed = true;
  const reply = delegated.answer;
  appendHistory(input.state, "assistant", reply);

  return {
    handled: true,
    projectKey: delegated.projectKey,
    reply,
    escalated: false,
    escalationSent: false
  } as AgentReply;
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

  const explicitProject = ensureKnownProjectKey(detectProjectByText(message));
  const previous = conversations.get(phone);
  const projectKey = explicitProject ?? ensureKnownProjectKey(previous?.projectKey) ?? env.defaultProject;
  const state = getConversation(phone, projectKey);
  if (explicitProject) {
    state.projectKey = explicitProject;
    state.projectConfirmed = true;
  }
  appendHistory(state, "user", message);
  state.lead = updateLeadProfileFromMessage(state.lead, message);

  try {
    if (state.awaitingHumanTransferData) {
      return await runHumanTransferQualification({
        state,
        phoneE164: phone,
        firstInteraction: false
      });
    }

    const decision = classifyRouting(message, state);

    if (decision.kind === "support_project") {
      return await runProjectRedirect({
        state,
        phoneE164: phone,
        message,
        projectKey: decision.projectKey,
        objective: "Resolver soporte tecnico del usuario en el proyecto indicado."
      });
    }

    if (decision.kind === "support_project_unknown") {
      const reply =
        "Te ayudo con soporte. Es sobre LuxiSoft, NAVAI o LuxiChat? Con eso te redirijo al especialista correcto.";
      appendHistory(state, "assistant", reply);
      return {
        handled: true,
        projectKey: state.projectKey,
        reply,
        escalated: false,
        escalationSent: false
      };
    }

    if (decision.kind === "sales_project") {
      return await runProjectRedirect({
        state,
        phoneE164: phone,
        message,
        projectKey: decision.projectKey,
        objective: "Atender interes comercial del usuario para el proyecto indicado."
      });
    }

    if (decision.kind === "sales_offer_catalog") {
      const reply = formatCatalogOfferMessage();
      appendHistory(state, "assistant", reply);
      return {
        handled: true,
        projectKey: state.projectKey,
        reply,
        escalated: false,
        escalationSent: false
      };
    }

    if (decision.kind === "human_scope_check") {
      const reply = [
        "Antes de transferirte, confirmo algo:",
        "Si es soporte o compra de LuxiSoft, NAVAI o LuxiChat, te redirijo de una vez al especialista de la aplicacion/servicio.",
        "Si es una necesidad diferente a esos servicios, te transfiero con humano."
      ].join("\n");
      appendHistory(state, "assistant", reply);
      return {
        handled: true,
        projectKey: state.projectKey,
        reply,
        escalated: false,
        escalationSent: false
      };
    }

    if (decision.kind === "outside_transfer") {
      state.awaitingHumanTransferData = true;
      return await runHumanTransferQualification({
        state,
        phoneE164: phone,
        firstInteraction: true
      });
    }

    const orchestrated = await runOrchestrator({
      phoneE164: phone,
      message,
      state,
      preferredProjectKey: projectKey
    });

    state.projectKey = ensureKnownProjectKey(orchestrated.projectKey) ?? state.projectKey;
    appendHistory(state, "assistant", orchestrated.reply);

    return {
      handled: true,
      projectKey: state.projectKey,
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
