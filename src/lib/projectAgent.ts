import path from "node:path";
import {
  listProjectKeys,
  loadOrchestratorAgent,
  loadProjectAgent,
  type AgentScriptRuntimeContext
} from "../agents/repository.js";
import { env } from "../env.js";
import { trackMeetingScheduled, trackOpenAIFailure, trackOpenAIUsage, trackOperationalError } from "./reporting.js";
import { scrapePageTextFromHtml } from "./scraping/textWeb.js";
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

type MeetingProfile = {
  meetingDay: string | null;
  meetingDate: string | null;
  meetingTime: string | null;
  meetingReason: string | null;
};

type ConversationState = {
  projectKey: string;
  projectConfirmed: boolean;
  history: Array<{ role: "user" | "assistant"; text: string; at: number }>;
  lead: LeadProfile;
  meeting: MeetingProfile;
  awaitingMeetingData: boolean;
  lastReplyStyle: ReplyStyle | null;
  openaiOrchestratorPreviousResponseId: string | null;
  openaiProjectPreviousResponseIds: Record<string, string>;
};

type ReplyStyle = "natural" | "bullets" | "question" | "steps";
type LinkPolicy = "avoid_links" | "one_link_if_helpful" | "links_if_requested";

type ReplyPlan = {
  style: ReplyStyle;
  linkPolicy: LinkPolicy;
};

type ProjectKnowledgeSource = {
  sourceUrl: string;
  text: string;
  snippets: string[];
  links: string[];
};

type ProjectKnowledgeDictionary = {
  projectKey: string;
  sources: Record<string, ProjectKnowledgeSource>;
};

type CachedKnowledge = {
  loadedAt: number;
  text: string;
  dictionary: ProjectKnowledgeDictionary;
};

type CrawledKnowledgePage = {
  sourceUrl: string;
  raw: string;
  text: string;
  snippets: string[];
  links: string[];
};

type ProjectAgentResult = {
  projectKey: string;
  answer: string;
  toolsUsed: string[];
  responseId: string | null;
};

type OrchestratorResult = {
  projectKey: string;
  reply: string;
  escalated: boolean;
  escalationSent: boolean;
  responseId: string | null;
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
const MAX_PAGE_SNIPPETS = 250;

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

const MEETING_KEYWORDS = [
  "agendar reunion",
  "agendar reunión",
  "agendar",
  "reunion",
  "reunión",
  "meeting",
  "agenda",
  "demo",
  "cita",
  "llamada",
  "videollamada"
];

const ASSISTANT_NAME = "Valeria";
const ASSISTANT_COMPANY = "LuxiSoft";
const REPLY_STYLE_ROTATION: ReplyStyle[] = ["natural", "bullets", "question", "steps"];

const LINK_REQUEST_KEYWORDS = [
  "enlace",
  "link",
  "url",
  "sitio oficial",
  "pagina oficial",
  "web oficial",
  "pasame la web",
  "pasame el link",
  "dame el link"
];

const LIST_REQUEST_KEYWORDS = [
  "lista",
  "opciones",
  "puntos",
  "enumerado",
  "resumen",
  "comparacion",
  "compara"
];

const STEP_REQUEST_KEYWORDS = [
  "paso a paso",
  "pasos",
  "como empiezo",
  "proceso",
  "flujo",
  "implementacion"
];

const LEAD_REQUIRED_FIELDS: Array<keyof LeadProfile> = [
  "firstName",
  "lastName",
  "company",
  "email"
];

const LEAD_FIELD_QUESTIONS: Record<keyof LeadProfile, string> = {
  firstName: "Por favor indicame tus nombres.",
  lastName: "Ahora indicame tus apellidos.",
  company: "Cual es tu empresa?",
  email: "Cual es tu correo de contacto?",
  need: "Que necesitas exactamente o que quieres resolver?"
};

const MEETING_REQUIRED_FIELDS: Array<keyof MeetingProfile> = [
  "meetingDay",
  "meetingDate",
  "meetingReason"
];

const MEETING_FIELD_QUESTIONS: Record<keyof MeetingProfile, string> = {
  meetingDay: "Que dia prefieres para la reunion? (ejemplo: martes)",
  meetingDate: "Que fecha prefieres? (ejemplo: 2026-03-25 o 25/03/2026)",
  meetingTime: "Si tienes una hora preferida, compartela (opcional).",
  meetingReason: "Cual es el motivo puntual de la reunion?"
};

type RoutingDecision =
  | { kind: "support_project"; projectKey: string }
  | { kind: "support_project_unknown" }
  | { kind: "sales_project"; projectKey: string }
  | { kind: "sales_offer_catalog" }
  | { kind: "meeting_interest" }
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

function emptyMeetingProfile(): MeetingProfile {
  return {
    meetingDay: null,
    meetingDate: null,
    meetingTime: null,
    meetingReason: null
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

function updateMeetingProfileFromMessage(profile: MeetingProfile, message: string, lead: LeadProfile): MeetingProfile {
  const next: MeetingProfile = { ...profile };
  const text = String(message ?? "");

  const dayMatch = text.match(
    /\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i
  );
  if (dayMatch?.[1]) {
    next.meetingDay = titleCase(dayMatch[1]);
  }

  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/);
  if (dateMatch?.[1]) {
    next.meetingDate = sanitizeValue(dateMatch[1], 40);
  }

  const timeMatch = text.match(/\b([01]?\d|2[0-3])[:.]([0-5]\d)\s*(am|pm)?\b/i);
  if (timeMatch) {
    const suffix = timeMatch[3] ? ` ${timeMatch[3].toUpperCase()}` : "";
    next.meetingTime = `${timeMatch[1]}:${timeMatch[2]}${suffix}`;
  }

  const reasonMatch = text.match(/(?:motivo|razon|razón)\s*[:\-]\s*([^\n.]+)/i);
  if (reasonMatch?.[1]) {
    next.meetingReason = sanitizeValue(reasonMatch[1], 220);
  }

  if (!next.meetingReason) {
    next.meetingReason = sanitizeValue(lead.need, 220);
  }

  return next;
}

function getMissingMeetingFields(state: ConversationState) {
  const missingLead = getMissingLeadFields(state.lead);
  const missingMeeting = MEETING_REQUIRED_FIELDS.filter(
    (field) => !sanitizeValue(state.meeting[field], 220)
  );
  return {
    missingLead,
    missingMeeting
  };
}

function firstOfficialSource(projectKey: string) {
  return resolveWebSources(projectKey)[0] ?? "sin fuente web oficial configurada";
}

function assistantMessageCount(state: ConversationState) {
  return state.history.filter((item) => item.role === "assistant").length;
}

function nextReplyStyle(state: ConversationState): ReplyStyle {
  if (!state.lastReplyStyle) return REPLY_STYLE_ROTATION[0];
  const currentIndex = REPLY_STYLE_ROTATION.indexOf(state.lastReplyStyle);
  if (currentIndex < 0) return REPLY_STYLE_ROTATION[0];
  return REPLY_STYLE_ROTATION[(currentIndex + 1) % REPLY_STYLE_ROTATION.length];
}

function buildReplyPlan(state: ConversationState, message: string): ReplyPlan {
  const normalized = normalizeText(message);
  const asksLinks = LINK_REQUEST_KEYWORDS.some((item) => normalized.includes(normalizeText(item)));
  const asksList = LIST_REQUEST_KEYWORDS.some((item) => normalized.includes(normalizeText(item)));
  const asksSteps = STEP_REQUEST_KEYWORDS.some((item) => normalized.includes(normalizeText(item)));

  let style = nextReplyStyle(state);
  if (asksList) style = "bullets";
  if (asksSteps) style = "steps";

  const linkPolicy: LinkPolicy = asksLinks
    ? "links_if_requested"
    : style === "bullets" || style === "steps"
      ? "one_link_if_helpful"
      : "avoid_links";

  return { style, linkPolicy };
}

function describeReplyStyle(style: ReplyStyle) {
  if (style === "bullets") return "Usa un formato con bullets breves y cierre accionable.";
  if (style === "steps") return "Usa un formato paso a paso corto (2-4 pasos).";
  if (style === "question") return "Usa un texto corto y cierra con una pregunta de avance.";
  return "Usa un parrafo breve y natural, sin bullets.";
}

function describeLinkPolicy(linkPolicy: LinkPolicy) {
  if (linkPolicy === "links_if_requested") {
    return "Puedes incluir URLs completas oficiales cuando agreguen valor directo a la consulta.";
  }
  if (linkPolicy === "one_link_if_helpful") {
    return "Incluye maximo 1 URL oficial solo si mejora la respuesta.";
  }
  return "Evita incluir URLs salvo que el usuario las pida explicitamente.";
}

function maybeIdentityIntro(state: ConversationState, reply: string) {
  if (assistantMessageCount(state) > 0) return reply.trim();

  const trimmed = reply.trim();
  if (!trimmed) return trimmed;

  if (new RegExp(`\\b${ASSISTANT_NAME}\\b`, "i").test(trimmed)) return trimmed;
  return `Hola, soy ${ASSISTANT_NAME}, asistente de ${ASSISTANT_COMPANY}. Encantada de ayudarte.\n${trimmed}`;
}

function finalizeAssistantReply(state: ConversationState, reply: string, plan: ReplyPlan) {
  state.lastReplyStyle = plan.style;
  return maybeIdentityIntro(state, reply).slice(0, MAX_RESPONSE_CHARS);
}

function formatCatalogOfferMessage(plan: ReplyPlan) {
  const offers = [
    { label: PROJECT_OFFERS.luxisoft, url: firstOfficialSource("luxisoft") },
    { label: PROJECT_OFFERS.navai, url: firstOfficialSource("navai") },
    { label: PROJECT_OFFERS.luxichat, url: firstOfficialSource("luxichat") }
  ];

  if (plan.style === "bullets") {
    const lines = ["Puedo ayudarte con estas aplicaciones/servicios oficiales:"];
    for (const offer of offers) {
      lines.push(plan.linkPolicy === "avoid_links" ? `- ${offer.label}` : `- ${offer.label}: ${offer.url}`);
    }
    lines.push("Dime cual te interesa y te orientare al siguiente paso.");
    return lines.join("\n");
  }

  if (plan.style === "steps") {
    const base = [
      "1. Elige el servicio: LuxiSoft, NAVAI o LuxiChat.",
      "2. Te explico capacidades confirmadas y siguiente paso comercial."
    ];
    if (plan.linkPolicy !== "avoid_links") {
      base.push(`3. Si quieres, te comparto la web oficial (${offers[0].url}, ${offers[1].url}, ${offers[2].url}).`);
    }
    return base.join("\n");
  }

  if (plan.style === "question") {
    return "Trabajo con informacion oficial de LuxiSoft, NAVAI y LuxiChat. Cual te interesa para continuar?";
  }

  if (plan.linkPolicy === "avoid_links") {
    return "Puedo ayudarte con informacion oficial de LuxiSoft, NAVAI y LuxiChat. Dime cual te interesa y te guio para avanzar.";
  }

  return [
    "Puedo ayudarte con informacion oficial de LuxiSoft, NAVAI y LuxiChat.",
    `Si deseas, te comparto la web oficial de cada uno: ${offers[0].url}, ${offers[1].url}, ${offers[2].url}.`,
    "Dime cual te interesa para continuar."
  ].join("\n");
}

function formatSupportUnknownReply(plan: ReplyPlan) {
  if (plan.style === "bullets") {
    return [
      "Te ayudo con soporte.",
      "- LuxiSoft",
      "- NAVAI",
      "- LuxiChat",
      "Indicame cual es y te redirijo al especialista."
    ].join("\n");
  }

  if (plan.style === "steps") {
    return [
      "1. Confirmame el servicio: LuxiSoft, NAVAI o LuxiChat.",
      "2. Con eso te redirijo al especialista de soporte."
    ].join("\n");
  }

  return "Te ayudo con soporte. Es sobre LuxiSoft, NAVAI o LuxiChat? Con eso te redirijo al especialista correcto.";
}

function formatHumanScopeCheckReply(plan: ReplyPlan) {
  if (plan.style === "question") {
    return "Puedo atenderte directamente por este canal. Si quieres que un especialista humano te contacte, puedo agendar una reunion. Te la agendo?";
  }

  if (plan.style === "steps") {
    return [
      "1. Te atiendo directamente por este canal para dudas de servicios.",
      "2. Si quieres contacto humano, te agendo reunion con especialista.",
      "3. Te pedire nombre, empresa, correo, fecha/dia y motivo."
    ].join("\n");
  }

  return [
    "Puedo atenderte directamente por este canal.",
    "Si prefieres contacto humano, con gusto te agendo una reunion con especialista.",
    "Para eso te pedire nombre, empresa, correo, fecha/dia y motivo."
  ].join("\n");
}

function formatInitialDiscoveryReply(plan: ReplyPlan) {
  if (plan.style === "bullets") {
    return [
      "Para ayudarte mejor, confirmame:",
      "- servicio de interes (LuxiSoft, NAVAI o LuxiChat)",
      "- objetivo principal",
      "- si buscas implementacion, soporte o cotizacion"
    ].join("\n");
  }

  if (plan.style === "steps") {
    return [
      "Para avanzar rapido:",
      "1. Dime el servicio: LuxiSoft, NAVAI o LuxiChat.",
      "2. Cuentame el objetivo que quieres lograr.",
      "3. Te doy la mejor ruta con informacion oficial."
    ].join("\n");
  }

  if (plan.style === "question") {
    return "Para ayudarte mejor, te interesa LuxiSoft, NAVAI o LuxiChat? Y que necesitas resolver primero?";
  }

  return "Para ayudarte mejor, dime si te interesa LuxiSoft, NAVAI o LuxiChat, y que objetivo quieres resolver.";
}

function isAssistantIdentityRequest(message: string) {
  const normalized = normalizeText(message);
  return /(como te llamas|cual es tu nombre|quien eres|presentate|tu nombre)/i.test(normalized);
}

function isAssistantPersonalInfoRequest(message: string) {
  const normalized = normalizeText(message);
  return /(?:tu edad|cuantos anos tienes|donde vives|tu direccion|tu telefono personal|tu whatsapp|tu numero personal|tu correo personal|tus redes|estado civil|estas casada|estas soltera|tu pareja)/i.test(
    normalized
  );
}

function formatAssistantIdentityReply(plan: ReplyPlan) {
  if (plan.style === "bullets") {
    return [
      `- Mi nombre es ${ASSISTANT_NAME}.`,
      `- Soy asistente de ${ASSISTANT_COMPANY}.`,
      "Puedo ayudarte con informacion oficial de nuestros servicios."
    ].join("\n");
  }

  if (plan.style === "steps") {
    return [
      `1. Mi nombre es ${ASSISTANT_NAME}.`,
      `2. Trabajo como asistente de ${ASSISTANT_COMPANY}.`,
      "3. Te ayudo con informacion oficial de servicios y siguientes pasos."
    ].join("\n");
  }

  return `Mi nombre es ${ASSISTANT_NAME} y soy asistente de ${ASSISTANT_COMPANY}. Te ayudo con informacion oficial de nuestros servicios.`;
}

function formatAssistantPrivacyReply() {
  return `Por politica interna solo puedo compartir mi nombre (${ASSISTANT_NAME}) y que trabajo en ${ASSISTANT_COMPANY}. Si quieres, te ayudo con informacion oficial de la empresa.`;
}

function buildMeetingCollectionPrompt(state: ConversationState, firstInteraction: boolean, plan: ReplyPlan) {
  const { missingLead, missingMeeting } = getMissingMeetingFields(state);
  const nextLead = missingLead[0] ?? null;
  const nextMeeting = missingMeeting[0] ?? null;
  const nextQuestion = nextLead ? LEAD_FIELD_QUESTIONS[nextLead] : nextMeeting ? MEETING_FIELD_QUESTIONS[nextMeeting] : null;
  if (!nextQuestion) return null;

  if (firstInteraction) {
    if (plan.style === "steps") {
      return [
        "Perfecto, para agendar reunion con un especialista humano necesito:",
        "1. nombres y apellidos",
        "2. empresa",
        "3. correo",
        "4. dia y fecha de reunion",
        "5. motivo de la reunion",
        nextQuestion
      ].join("\n");
    }

    return [
      "Perfecto, para agendar reunion con un especialista humano necesito estos datos:",
      "- nombres",
      "- apellidos",
      "- empresa",
      "- correo",
      "- dia y fecha de reunion",
      "- motivo de la reunion",
      nextQuestion
    ].join("\n");
  }

  return nextQuestion;
}

function classifyRouting(message: string, state: ConversationState): RoutingDecision {
  const support = containsKeyword(message, SUPPORT_KEYWORDS);
  const buy = containsKeyword(message, BUY_KEYWORDS);
  const human = containsKeyword(message, HUMAN_KEYWORDS);
  const meeting = containsKeyword(message, MEETING_KEYWORDS);

  const mentionedProject = ensureKnownProjectKey(detectProjectByText(message));
  const currentProject = ensureKnownProjectKey(state.projectKey);
  const contextProject = state.projectConfirmed ? currentProject : null;

  if (meeting) {
    return { kind: "meeting_interest" };
  }

  if (support) {
    const target = mentionedProject ?? contextProject;
    if (target) return { kind: "support_project", projectKey: target };
    return { kind: "support_project_unknown" };
  }

  if (buy) {
    const target = mentionedProject ?? contextProject;
    if (target) return { kind: "sales_project", projectKey: target };
    return { kind: "sales_offer_catalog" };
  }

  if (human) {
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

function extractHttpUrlsFromText(value: string) {
  const matches = String(value ?? "").match(/https?:\/\/[^\s<>"'`]+/gi) ?? [];
  const deduped = new Map<string, string>();

  for (const item of matches) {
    const normalized = normalizeHttpUrl(item, item);
    if (!normalized) continue;
    const key = normalizeComparableUrl(normalized);
    if (!deduped.has(key)) deduped.set(key, normalized);
  }

  return Array.from(deduped.values());
}

function buildKnowledgeCacheKey(projectKey: string, sources: string[]) {
  const normalizedSources = sources
    .map((source) => normalizeComparableUrl(source))
    .sort((a, b) => a.localeCompare(b));
  return `${projectKey}::${normalizedSources.join("|")}`;
}

function sameDomainAsAnySource(candidateUrl: string, sources: string[]) {
  try {
    const candidate = new URL(candidateUrl);
    return sources.some((source) => {
      try {
        const root = new URL(source);
        return isSameDomain(candidate.host, root.host);
      } catch {
        return false;
      }
    });
  } catch {
    return false;
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
    const snippets = scrapePageTextFromHtml(raw, {
      dedupe: true,
      minLength: 2,
      onlyVisible: true,
      includeLinkText: false,
      excludeUrlLikeText: true
    }).slice(0, MAX_PAGE_SNIPPETS);
    const normalized = snippets.join("\n").slice(0, MAX_PAGE_TEXT_CHARS).trim();
    if (!normalized) return null;
    const links = extractSourceLinks(raw, sourceUrl);

    return {
      sourceUrl,
      raw,
      text: normalized,
      snippets,
      links
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
  const pages: CrawledKnowledgePage[] = [];

  while (queue.length > 0 && visited.size < MAX_CRAWL_PAGES_PER_SOURCE) {
    const current = queue.shift()!;
    const comparableCurrent = normalizeComparableUrl(current.url);
    if (visited.has(comparableCurrent)) continue;
    visited.add(comparableCurrent);

    const page = await fetchRemotePage(current.url);
    if (!page) continue;

    pages.push(page);

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

  return pages;
}

function buildProjectKnowledgeDictionary(projectKey: string, pages: CrawledKnowledgePage[]) {
  const sources: Record<string, ProjectKnowledgeSource> = {};

  for (const page of pages) {
    const key = normalizeComparableUrl(page.sourceUrl);
    const previous = sources[key];
    if (!previous) {
      sources[key] = {
        sourceUrl: page.sourceUrl,
        text: page.text.slice(0, MAX_PAGE_TEXT_CHARS),
        snippets: page.snippets,
        links: page.links.slice(0, MAX_SOURCE_LINKS_PER_PAGE)
      };
      continue;
    }

    const mergedSnippets = Array.from(new Set([...previous.snippets, ...page.snippets])).slice(
      0,
      MAX_PAGE_SNIPPETS
    );
    const mergedLinks = Array.from(new Set([...previous.links, ...page.links])).slice(
      0,
      MAX_SOURCE_LINKS_PER_PAGE
    );

    sources[key] = {
      sourceUrl: previous.sourceUrl,
      snippets: mergedSnippets,
      links: mergedLinks,
      text: mergedSnippets.join("\n").slice(0, MAX_PAGE_TEXT_CHARS)
    };
  }

  return {
    projectKey,
    sources
  } as ProjectKnowledgeDictionary;
}

function knowledgeTextFromDictionary(dictionary: ProjectKnowledgeDictionary) {
  const sections: string[] = [];
  const ordered = Object.values(dictionary.sources).sort((a, b) =>
    a.sourceUrl.localeCompare(b.sourceUrl)
  );

  for (const source of ordered) {
    sections.push(`[source:${source.sourceUrl}]`);
    sections.push(source.text.slice(0, MAX_PAGE_TEXT_CHARS));
    if (source.links.length) {
      sections.push(`[source_links:${source.sourceUrl}]`);
      sections.push(...source.links.map((item) => `- ${item}`));
    }
  }

  return sections.join("\n").trim();
}

function resolveSources(projectKey: string, promptText = "") {
  const configured = env.agentProjectSources[projectKey] ?? [];
  const fallback = DEFAULT_PROJECT_SOURCES[projectKey] ?? [];
  const promptUrls = extractHttpUrlsFromText(promptText);
  return Array.from(new Set([...configured, ...fallback, ...promptUrls])).filter(Boolean);
}

function resolveWebSources(projectKey: string, promptText = "") {
  const deduped = new Map<string, string>();
  for (const source of resolveSources(projectKey, promptText)) {
    const normalized = normalizeHttpUrl(source, source);
    if (!normalized) continue;
    const key = normalizeComparableUrl(normalized);
    if (!deduped.has(key)) deduped.set(key, normalized);
  }
  return Array.from(deduped.values());
}

async function loadProjectKnowledge(projectKey: string, webSources: string[]) {
  const sources = webSources.filter((source) => /^https?:\/\//i.test(source));
  const cacheKey = buildKnowledgeCacheKey(projectKey, sources);
  const now = Date.now();
  const cached = knowledgeCache.get(cacheKey);
  if (cached && now - cached.loadedAt <= KNOWLEDGE_CACHE_TTL_MS) {
    return cached;
  }

  const pages: CrawledKnowledgePage[] = [];
  for (const source of sources) {
    const loaded = await fetchRemoteSource(source);
    if (loaded.length) pages.push(...loaded);
  }

  const dictionary = buildProjectKnowledgeDictionary(projectKey, pages);
  const knowledge = knowledgeTextFromDictionary(dictionary);
  const loaded = { loadedAt: now, text: knowledge, dictionary };
  knowledgeCache.set(cacheKey, loaded);
  return loaded;
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

function pickRelevantSnippetsFromDictionary(dictionary: ProjectKnowledgeDictionary, question: string) {
  const queryTokens = new Set(tokenize(question));
  if (!queryTokens.size) return [] as string[];

  const candidates = Object.values(dictionary.sources)
    .flatMap((source) =>
      source.snippets.map((snippet) => ({
        sourceUrl: source.sourceUrl,
        snippet
      }))
    )
    .filter((item) => item.snippet.length >= 30)
    .slice(0, 2500);

  return candidates
    .map((item) => {
      const score = tokenize(item.snippet).reduce(
        (acc, token) => (queryTokens.has(token) ? acc + 1 : acc),
        0
      );
      return { ...item, score };
    })
    .filter((item) => item.score > 0)
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return b.snippet.length - a.snippet.length;
    })
    .slice(0, MAX_GROUNDING_SNIPPETS)
    .map((item) => item.snippet.slice(0, 280));
}

async function searchKnowledge(input: {
  projectKey: string;
  query: string;
  sources: string[];
  sourceUrl?: string;
}) {
  const requestedSourceUrl = normalizeHttpUrl(String(input.sourceUrl ?? "").trim(), String(input.sourceUrl ?? "").trim());
  const effectiveSources =
    requestedSourceUrl && sameDomainAsAnySource(requestedSourceUrl, input.sources)
      ? [requestedSourceUrl]
      : input.sources;
  const knowledge = await loadProjectKnowledge(input.projectKey, effectiveSources);
  const fromDictionary = pickRelevantSnippetsFromDictionary(knowledge.dictionary, input.query);
  if (fromDictionary.length) return fromDictionary;
  return pickRelevantSnippets(knowledge.text, input.query);
}

function buildGroundingBlock(snippets: string[]) {
  return snippets
    .slice(0, MAX_GROUNDING_SNIPPETS)
    .map((snippet, index) => `[${index + 1}] ${snippet}`)
    .join("\n");
}

function buildNoGroundingReply(projectKey: string, plan: ReplyPlan, sources: string[]) {
  const lines = [
    `Revise las paginas oficiales de ${projectKey} y ese punto exacto no aparece publicado por ahora.`
  ];

  if (sources.length && plan.linkPolicy !== "avoid_links") {
    lines.push("Fuentes oficiales revisadas:");
    lines.push(...sources.slice(0, plan.linkPolicy === "one_link_if_helpful" ? 1 : 3));
  }

  lines.push("Si quieres, te propongo el siguiente paso comercial o agendamos una reunion con especialista.");
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

function normalizeResponseId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function shouldResetPreviousResponseHistory(err: any) {
  const statusCode = Number(err?.statusCode ?? 0);
  if (![400, 404].includes(statusCode)) return false;

  const details = String(
    err?.details?.error?.code ??
      err?.details?.error?.message ??
      err?.details?.message ??
      ""
  ).toLowerCase();

  return (
    details.includes("previous_response_id") ||
    details.includes("response_not_found") ||
    details.includes("invalid previous response") ||
    details.includes("conversation")
  );
}

async function openaiResponsesCreate(payload: Record<string, unknown>) {
  if (!env.openaiApiKey) {
    throw new Error("openai_not_configured");
  }

  const requestModel = String(payload.model ?? "").trim() || "unknown_model";

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
    trackOpenAIFailure();
    trackOperationalError();
    throw Object.assign(new Error("openai_responses_failed"), {
      statusCode: response.status,
      details: parsed
    });
  }

  trackOpenAIUsage({
    model: String(parsed?.model ?? requestModel).trim() || requestModel,
    usage: parsed?.usage ?? null
  });

  return parsed;
}

async function openaiResponsesCreateWithHistory(input: {
  payload: Record<string, unknown>;
  previousResponseId?: string | null;
}) {
  const previousResponseId = normalizeResponseId(input.previousResponseId);
  if (!previousResponseId) {
    return openaiResponsesCreate(input.payload);
  }

  try {
    return await openaiResponsesCreate({
      ...input.payload,
      previous_response_id: previousResponseId
    });
  } catch (err: any) {
    if (!shouldResetPreviousResponseHistory(err)) {
      throw err;
    }
    return openaiResponsesCreate(input.payload);
  }
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

function buildMeetingSummary(state: ConversationState, phoneE164: string) {
  const recentUserMessages = state.history
    .filter((item) => item.role === "user")
    .slice(-4)
    .map((item) => `- ${item.text.slice(0, 220)}`)
    .join("\n");

  return [
    "[Agenda reunion - LuxiSoft]",
    `Nombre: ${state.lead.firstName ?? "(sin dato)"} ${state.lead.lastName ?? ""}`.trim(),
    `Empresa: ${state.lead.company ?? "(sin dato)"}`,
    `Correo: ${state.lead.email ?? "(sin dato)"}`,
    `Telefono WhatsApp: ${phoneE164}`,
    `Dia preferido: ${state.meeting.meetingDay ?? "(sin dato)"}`,
    `Fecha preferida: ${state.meeting.meetingDate ?? "(sin dato)"}`,
    `Hora preferida: ${state.meeting.meetingTime ?? "(sin dato)"}`,
    `Motivo reunion: ${state.meeting.meetingReason ?? state.lead.need ?? "(sin dato)"}`,
    "Mensajes recientes del usuario:",
    recentUserMessages || "- Sin mensajes."
  ].join("\n");
}

function getConversation(phoneE164: string, projectKey: string) {
  const existing = conversations.get(phoneE164);
  if (existing) {
    if (projectKey) existing.projectKey = projectKey;
    if (!existing.lastReplyStyle) existing.lastReplyStyle = null;
    existing.openaiOrchestratorPreviousResponseId = normalizeResponseId(
      existing.openaiOrchestratorPreviousResponseId
    );
    if (
      !existing.openaiProjectPreviousResponseIds ||
      typeof existing.openaiProjectPreviousResponseIds !== "object" ||
      Array.isArray(existing.openaiProjectPreviousResponseIds)
    ) {
      existing.openaiProjectPreviousResponseIds = {};
    }
    return existing;
  }

  const initial: ConversationState = {
    projectKey,
    projectConfirmed: false,
    history: [],
    lead: emptyLeadProfile(),
    meeting: emptyMeetingProfile(),
    awaitingMeetingData: false,
    lastReplyStyle: null,
    openaiOrchestratorPreviousResponseId: null,
    openaiProjectPreviousResponseIds: {}
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
  replyPlan: ReplyPlan;
  previousResponseId?: string | null;
}): Promise<ProjectAgentResult> {
  const agentsDir = resolveAgentsDir();
  const preferredProjectKey = normalizeProjectKey(input.projectKey) || env.defaultProject;
  const project =
    (await loadProjectAgent(agentsDir, preferredProjectKey)) ??
    (await loadProjectAgent(agentsDir, env.defaultProject));

  if (!project) {
    return {
      projectKey: env.defaultProject,
      answer: "No hay agente de proyecto configurado en el servidor.",
      toolsUsed: [] as string[],
      responseId: null
    };
  }

  const projectSources = resolveWebSources(project.project_key, project.prompt);

  const groundingQuery = [input.objective ?? "", input.userMessage]
    .map((value) => String(value ?? "").trim())
    .filter(Boolean)
    .join(". ");
  const groundingSnippets = await searchKnowledge({
    projectKey: project.project_key,
    query: groundingQuery || input.userMessage,
    sources: projectSources
  });

  if (!groundingSnippets.length) {
    return {
      projectKey: project.project_key,
      answer: buildNoGroundingReply(project.project_key, input.replyPlan, projectSources),
      toolsUsed: [] as string[],
      responseId: null
    };
  }

  const runtimeContext: AgentScriptRuntimeContext = {
    projectKey: project.project_key,
    phoneE164: input.phoneE164,
    userMessage: input.userMessage,
    history: input.history.map((item) => ({ role: item.role, text: item.text })),
    sources: projectSources,
    searchKnowledge: (query, options) =>
      searchKnowledge({
        projectKey: project.project_key,
        query,
        sources: projectSources,
        sourceUrl: options?.sourceUrl
      })
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
    `Tu identidad comercial fija es ${ASSISTANT_NAME}, asistente de ${ASSISTANT_COMPANY}.`,
    "Cuando hables de ti, usa voz femenina.",
    `No compartas datos personales tuyos; solo puedes compartir tu nombre (${ASSISTANT_NAME}) y que trabajas en ${ASSISTANT_COMPANY}.`,
    "No repitas siempre el mismo formato. Sigue el FORMATO_DINAMICO_RECOMENDADO enviado por el sistema.",
    "No incluyas URLs en todas las respuestas. Sigue la POLITICA_DE_ENLACES enviada por el sistema.",
    "Responde exclusivamente con informacion presente en BLOQUE_DE_FUENTES_CONFIRMADAS.",
    "No uses conocimiento externo ni inventes datos no confirmados por fuentes oficiales.",
    "Si un dato no aparece en fuentes, responde con tono comercial seguro: explica lo que si esta publicado y el siguiente paso.",
    "Evita tono de inseguridad o frases ambiguas; habla con claridad.",
    "Si necesitas mas contexto del sitio, usa los tools disponibles antes de responder.",
    "Si compartes enlaces, usa URL completa oficial.",
    "Si el usuario pide contacto humano, ofrece agendar reunion con especialista."
  ].join("\n\n");

  const userPrompt = [
    `Proyecto: ${project.project_key}`,
    input.objective ? `Objetivo del orquestador: ${input.objective}` : "",
    `FORMATO_DINAMICO_RECOMENDADO: ${describeReplyStyle(input.replyPlan.style)}`,
    `POLITICA_DE_ENLACES: ${describeLinkPolicy(input.replyPlan.linkPolicy)}`,
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

  let response: any = await openaiResponsesCreateWithHistory({
    previousResponseId: input.previousResponseId,
    payload: {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      ...(tools.length ? { tools } : {})
    }
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
    toolsUsed: Array.from(toolsUsed),
    responseId: normalizeResponseId(response?.id)
  };
}

function isDirectChild(parentDir: string, childDir: string) {
  const parent = path.resolve(parentDir);
  const childParent = path.dirname(path.resolve(childDir));
  return parent === childParent;
}

async function notifyHumanMeeting(input: {
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
    "[Bridge -> humano] Solicitud de reunion",
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
      error: String(err?.message ?? "human_meeting_notify_failed")
    };
  }
}

async function runOrchestrator(input: {
  phoneE164: string;
  message: string;
  state: ConversationState;
  preferredProjectKey: string;
  replyPlan: ReplyPlan;
  previousResponseId?: string | null;
}): Promise<OrchestratorResult> {
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
    `Tu identidad comercial fija es ${ASSISTANT_NAME}, asistente de ${ASSISTANT_COMPANY}.`,
    "Cuando hables de ti, usa voz femenina.",
    `No compartas datos personales tuyos; solo puedes compartir tu nombre (${ASSISTANT_NAME}) y que trabajas en ${ASSISTANT_COMPANY}.`,
    "Aplica el formato dinamico sugerido por el sistema para no repetir siempre la misma estructura.",
    "No incluyas URLs en todas las respuestas; usa la politica de enlaces indicada.",
    "Para consultas de negocio/servicios/productos debes usar delegate_project_agent.",
    "No agregues datos tecnicos/comerciales que no vengan del subagente.",
    "Tu respuesta final debe basarse solo en informacion confirmada por el subagente.",
    "No transfieras automaticamente a humano. Si aplica, propone agendar reunion con especialista.",
    "No inventes informacion tecnica no confirmada por subagente."
  ].join("\n\n");

  const userPrompt = [
    `Telefono: ${input.phoneE164}`,
    `Proyecto preferido: ${selectedProject}`,
    `Proyectos disponibles: ${availableProjects.join(", ") || "ninguno"}`,
    `FORMATO_DINAMICO_RECOMENDADO: ${describeReplyStyle(input.replyPlan.style)}`,
    `POLITICA_DE_ENLACES: ${describeLinkPolicy(input.replyPlan.linkPolicy)}`,
    "Historial reciente:",
    buildHistoryBlock(input.state.history) || "Sin historial.",
    "",
    "Mensaje actual del usuario:",
    input.message
  ].join("\n");

  let response: any = await openaiResponsesCreateWithHistory({
    previousResponseId: input.previousResponseId,
    payload: {
      model,
      input: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt }
      ],
      tools
    }
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
          history: input.state.history,
          replyPlan: input.replyPlan,
          previousResponseId:
            input.state.openaiProjectPreviousResponseIds[requestedProject] ?? null
        });
        if (delegated.responseId) {
          input.state.openaiProjectPreviousResponseIds[delegated.projectKey] = delegated.responseId;
        }
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
    escalationSent: false,
    responseId: normalizeResponseId(response?.id)
  };
}

async function runMeetingQualification(input: {
  state: ConversationState;
  phoneE164: string;
  firstInteraction: boolean;
  replyPlan: ReplyPlan;
}) {
  const missing = getMissingMeetingFields(input.state);
  if (missing.missingLead.length > 0 || missing.missingMeeting.length > 0) {
    const prompt = buildMeetingCollectionPrompt(input.state, input.firstInteraction, input.replyPlan);
    const rawReply = prompt ?? "Necesito un dato adicional para continuar con la agenda de reunion.";
    const reply = finalizeAssistantReply(input.state, rawReply, input.replyPlan);
    appendHistory(input.state, "assistant", reply);
    return {
      handled: true,
      projectKey: input.state.projectKey,
      reply,
      escalated: true,
      escalationSent: false
    } as AgentReply;
  }

  const transfer = await notifyHumanMeeting({
    projectKey: input.state.projectKey,
    phoneE164: input.phoneE164,
    summary: buildMeetingSummary(input.state, input.phoneE164)
  });
  input.state.awaitingMeetingData = false;

  const rawReply = transfer.sent
    ? "Perfecto, ya agende tu solicitud de reunion con especialista. Te contactaran con los datos registrados."
    : "Registre tu solicitud, pero fallo el envio al agente humano en este momento. Intenta de nuevo en unos minutos.";
  const reply = finalizeAssistantReply(input.state, rawReply, input.replyPlan);
  appendHistory(input.state, "assistant", reply);

  trackMeetingScheduled({
    projectKey: input.state.projectKey,
    userPhone: input.phoneE164,
    contactName: `${input.state.lead.firstName ?? ""} ${input.state.lead.lastName ?? ""}`.trim(),
    contactEmail: input.state.lead.email ?? "",
    company: input.state.lead.company ?? "",
    meetingDay: input.state.meeting.meetingDay ?? "",
    meetingDate: input.state.meeting.meetingDate ?? "",
    meetingTime: input.state.meeting.meetingTime,
    reason: input.state.meeting.meetingReason ?? input.state.lead.need ?? "",
    notifiedHuman: transfer.sent
  });

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
  replyPlan: ReplyPlan;
}) {
  const delegated = await runProjectAgent({
    projectKey: input.projectKey,
    phoneE164: input.phoneE164,
    userMessage: input.message,
    objective: input.objective,
    history: input.state.history,
    replyPlan: input.replyPlan,
    previousResponseId:
      input.state.openaiProjectPreviousResponseIds[input.projectKey] ?? null
  });
  if (delegated.responseId) {
    input.state.openaiProjectPreviousResponseIds[delegated.projectKey] = delegated.responseId;
  }
  input.state.projectKey = delegated.projectKey;
  input.state.projectConfirmed = true;
  const reply = finalizeAssistantReply(input.state, delegated.answer, input.replyPlan);
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
  state.meeting = updateMeetingProfileFromMessage(state.meeting, message, state.lead);
  const replyPlan = buildReplyPlan(state, message);

  try {
    if (state.awaitingMeetingData) {
      return await runMeetingQualification({
        state,
        phoneE164: phone,
        firstInteraction: false,
        replyPlan
      });
    }

    if (isAssistantPersonalInfoRequest(message)) {
      const reply = finalizeAssistantReply(state, formatAssistantPrivacyReply(), replyPlan);
      appendHistory(state, "assistant", reply);
      return {
        handled: true,
        projectKey: state.projectKey,
        reply,
        escalated: false,
        escalationSent: false
      };
    }

    if (isAssistantIdentityRequest(message)) {
      const reply = finalizeAssistantReply(state, formatAssistantIdentityReply(replyPlan), replyPlan);
      appendHistory(state, "assistant", reply);
      return {
        handled: true,
        projectKey: state.projectKey,
        reply,
        escalated: false,
        escalationSent: false
      };
    }

    const decision = classifyRouting(message, state);
    const isFirstAssistantTurn = assistantMessageCount(state) === 0;

    if (
      isFirstAssistantTurn &&
      decision.kind !== "meeting_interest" &&
      decision.kind !== "human_scope_check"
    ) {
      const reply = finalizeAssistantReply(state, formatInitialDiscoveryReply(replyPlan), replyPlan);
      appendHistory(state, "assistant", reply);
      return {
        handled: true,
        projectKey: state.projectKey,
        reply,
        escalated: false,
        escalationSent: false
      };
    }

    if (decision.kind === "support_project") {
      return await runProjectRedirect({
        state,
        phoneE164: phone,
        message,
        projectKey: decision.projectKey,
        objective: "Resolver soporte tecnico del usuario en el proyecto indicado.",
        replyPlan
      });
    }

    if (decision.kind === "support_project_unknown") {
      const reply = finalizeAssistantReply(state, formatSupportUnknownReply(replyPlan), replyPlan);
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
        objective: "Atender interes comercial del usuario para el proyecto indicado.",
        replyPlan
      });
    }

    if (decision.kind === "sales_offer_catalog") {
      const reply = finalizeAssistantReply(state, formatCatalogOfferMessage(replyPlan), replyPlan);
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
      const reply = finalizeAssistantReply(state, formatHumanScopeCheckReply(replyPlan), replyPlan);
      appendHistory(state, "assistant", reply);
      return {
        handled: true,
        projectKey: state.projectKey,
        reply,
        escalated: false,
        escalationSent: false
      };
    }

    if (decision.kind === "meeting_interest") {
      state.awaitingMeetingData = true;
      return await runMeetingQualification({
        state,
        phoneE164: phone,
        firstInteraction: true,
        replyPlan
      });
    }

    const orchestrated = await runOrchestrator({
      phoneE164: phone,
      message,
      state,
      preferredProjectKey: projectKey,
      replyPlan,
      previousResponseId: state.openaiOrchestratorPreviousResponseId
    });
    state.openaiOrchestratorPreviousResponseId =
      orchestrated.responseId ?? state.openaiOrchestratorPreviousResponseId;

    state.projectKey = ensureKnownProjectKey(orchestrated.projectKey) ?? state.projectKey;
    const orchestratedReply = finalizeAssistantReply(state, orchestrated.reply, replyPlan);
    appendHistory(state, "assistant", orchestratedReply);

    return {
      handled: true,
      projectKey: state.projectKey,
      reply: orchestratedReply,
      escalated: orchestrated.escalated,
      escalationSent: orchestrated.escalationSent
    };
  } catch (err: any) {
    const rawFallback = `No pude responder por el momento (${String(err?.message ?? "agent_failed")}).`;
    const fallback = finalizeAssistantReply(state, rawFallback, replyPlan);
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
