import { readFileSync } from "node:fs";
import path from "node:path";
import {
  Agent,
  Runner,
  assistant,
  tool,
  user,
  type AgentInputItem
} from "@openai/agents";
import { OpenAIProvider } from "@openai/agents";
import { z } from "zod";
import {
  loadProjectAgent,
  type AgentScript,
  type AgentScriptRuntimeContext
} from "../agents/repository.js";
import { env } from "../env.js";
import {
  sendSupportTicketEmail,
  sendMeetingQuoteEmail,
  trackMeetingScheduled,
  trackOpenAIFailure,
  trackOpenAIUsage,
  trackOperationalError,
  trackSupportTicketCreated
} from "./reporting.js";
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

type SupportOwnership = "luxisoft" | "third_party";

type ConversationState = {
  projectKey: string;
  projectConfirmed: boolean;
  history: Array<{ role: "user" | "assistant"; text: string; at: number }>;
  lead: LeadProfile;
  pendingLeadField: keyof LeadProfile | null;
  awaitingProjectStatusName: boolean;
  meeting: MeetingProfile;
  supportTopic: string | null;
  supportOwnership: SupportOwnership | null;
  awaitingSupportOwnership: boolean;
  awaitingSupportTicketData: boolean;
  supportClosedAt: number | null;
  awaitingMeetingData: boolean;
  meetingClosedAt: number | null;
  lastReplyStyle: ReplyStyle | null;
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

type ConfiguredProjectStatusEntry = {
  name: string;
  aliases: string[];
  statusParagraph: string | null;
};

type SupportFieldKey = keyof LeadProfile;
type MeetingFieldKey = keyof MeetingProfile;

type ConversationCaseAnalysis = {
  ok: true;
  case_type:
    | "identity_request"
    | "privacy_request"
    | "project_status"
    | "project_status_name_required"
    | "support_with_us"
    | "support_third_party"
    | "support_ownership_required"
    | "closed_support"
    | "closed_meeting"
    | "meeting_request"
    | "sales_or_discovery"
    | "general";
  recommended_action:
    | "answer_identity"
    | "answer_privacy"
    | "lookup_project_status"
    | "ask_project_name"
    | "ask_support_ownership"
    | "collect_support_data"
    | "register_support_ticket"
    | "collect_meeting_data"
    | "schedule_meeting_request"
    | "reset_case_state"
    | "continue_sales_discovery"
    | "general_reply"
    | "closed_case_notice";
  support_topic: string | null;
  support_ownership: SupportOwnership | null;
  matched_project_name: string | null;
  project_name_required: boolean;
  support_closed: boolean;
  meeting_closed: boolean;
  reopen_signal: "support" | "meeting" | "general" | null;
  lead_profile: LeadProfile;
  meeting_profile: MeetingProfile;
  support_missing_fields: SupportFieldKey[];
  meeting_missing_lead_fields: SupportFieldKey[];
  meeting_missing_fields: MeetingFieldKey[];
  next_support_field: SupportFieldKey | null;
  next_support_question: string | null;
  next_meeting_field: SupportFieldKey | MeetingFieldKey | null;
  next_meeting_question: string | null;
  notes: string[];
};

const TurnAnalysisSchema = z.object({
  case_type: z.enum([
    "project_status",
    "project_status_name_required",
    "support_with_us",
    "support_third_party",
    "support_ownership_required",
    "closed_support",
    "closed_meeting",
    "meeting_request",
    "sales_or_discovery",
    "general"
  ]),
  recommended_action: z.enum([
    "lookup_project_status",
    "ask_project_name",
    "ask_support_ownership",
    "collect_support_data",
    "register_support_ticket",
    "collect_meeting_data",
    "schedule_meeting_request",
    "reset_case_state",
    "continue_sales_discovery",
    "general_reply",
    "closed_case_notice"
  ]),
  support_ownership: z.enum(["luxisoft", "third_party", "unknown"]),
  matched_project_name: z.string().trim().min(1).max(120).nullable(),
  rationale: z.string().trim().min(1).max(320),
  next_question_goal: z.string().trim().min(1).max(220).nullable()
});

type TurnAnalysis = z.infer<typeof TurnAnalysisSchema>;

const knowledgeCache = new Map<string, CachedKnowledge>();
const conversations = new Map<string, ConversationState>();
const projectStatusEntryCache = new Map<
  string,
  { loadedAt: number; entries: ConfiguredProjectStatusEntry[] }
>();
let projectAgentRunner: Runner | null | undefined;

const KNOWLEDGE_CACHE_TTL_MS = 10 * 60 * 1000;
const PROJECT_STATUS_CACHE_TTL_MS = 60 * 1000;
const MAX_HISTORY_ITEMS = 12;
const MAX_RESPONSE_CHARS = 1400;
const MAX_SOURCE_LINKS_PER_PAGE = 20;
const MAX_GROUNDING_SNIPPETS = 6;
const MAX_CRAWL_PAGES_PER_SOURCE = 6;
const MAX_CRAWL_DEPTH = 1;
const MAX_PAGE_TEXT_CHARS = 10_000;
const MAX_PAGE_SNIPPETS = 250;

const DEFAULT_PROJECT_SOURCES: Record<string, string[]> = {
  luxisoft: ["https://luxisoft.com/en/"]
};

const SUPPORT_KEYWORDS = [
  "soporte",
  "ayuda",
  "problema",
  "error",
  "falla",
  "incidencia",
  "ayuda tecnica",
  "no funciona",
  "no esta funcionando",
  "funciona mal",
  "responde mal",
  "respondiendo mal"
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
  "producto",
  "tienda virtual",
  "ecommerce",
  "e-commerce",
  "pasarela de pago",
  "pagina",
  "pagina web",
  "web",
  "sitio",
  "sitio web",
  "landing page",
  "tienda",
  "app",
  "aplicacion",
  "aplicacion movil",
  "android",
  "ios",
  "automatizacion",
  "inteligencia artificial",
  "asistente virtual",
  "vender"
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

const GREETING_TOKENS = new Set([
  "hola",
  "hello",
  "hi",
  "buenos",
  "buenas",
  "buen",
  "dia",
  "dias",
  "tardes",
  "noches",
  "saludos",
  "que",
  "como",
  "tal",
  "estas",
  "estoy",
  "soy",
  "gracias",
  "vale",
  "ok",
  "okay",
  "ey",
  "hey"
]);

const STANDALONE_NAME_BLOCKED_TOKENS = new Set([
  "fue",
  "adquirido",
  "adquirida",
  "adquirir",
  "con",
  "ustedes",
  "luxisoft",
  "tercero",
  "terceros",
  "proveedor",
  "empresa",
  "negocio",
  "correo",
  "mail",
  "gmail",
  "nombre",
  "nombres",
  "apellido",
  "apellidos",
  "necesito",
  "ayuda",
  "soporte",
  "problema",
  "error",
  "falla",
  "app",
  "aplicacion",
  "web",
  "ia",
  "agente",
  "servicio",
  "cotizacion",
  "gracias",
  "hola",
  "buen",
  "dia",
  "buenos",
  "buenas",
  "si",
  "no"
]);

const NEED_SIGNAL_REGEX =
  /(?:necesit|quier|quisier|busc|requier|cotiz|presupuesto|interesad[oa]|me interesa|me gustaria|deseo|pagina|sitio|tienda|ecommerce|app|aplicacion|automatiz|ia|inteligencia artificial|asistente virtual)/i;

const SUPPORT_SIGNAL_REGEX =
  /(?:ayuda|soporte|problema|error|falla|incidencia|no\s+funcion|no\s+esta\s+funcionando|funcionando\s+mal|funciona\s+mal|respondiendo\s+mal|responde\s+mal)/i;

const ASSISTANT_NAME = "Valeria";
const ASSISTANT_COMPANY = "LUXISOFT";
const REPLY_STYLE_ROTATION: ReplyStyle[] = ["natural", "question"];

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

const REOPEN_AFTER_MEETING_KEYWORDS = [
  "nuevo proyecto",
  "nueva consulta",
  "otra consulta",
  "otra cotizacion",
  "nueva cotizacion",
  "empezar de nuevo",
  "reiniciar"
];

const REOPEN_AFTER_SUPPORT_KEYWORDS = [
  "nuevo ticket",
  "nueva solicitud",
  "otra solicitud",
  "otro caso",
  "nuevo caso",
  "nuevo proyecto",
  "reiniciar"
];

const POST_MEETING_COURTESY_KEYWORDS = [
  "gracias",
  "muchas gracias",
  "vale",
  "ok",
  "okay",
  "listo",
  "perfecto",
  "entendido",
  "genial",
  "excelente",
  "bien",
  "dale",
  "de acuerdo",
  "adios",
  "chau",
  "hasta luego",
  "hasta pronto",
  "bye"
];

const LEAD_REQUIRED_FIELDS: Array<keyof LeadProfile> = [
  "firstName",
  "lastName",
  "company",
  "email"
];

const SUPPORT_REQUIRED_FIELDS: Array<keyof LeadProfile> = [
  "firstName",
  "lastName",
  "company",
  "email",
  "need"
];

const LEAD_PROGRESS_FIELDS: Array<keyof LeadProfile> = [
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

const SUPPORT_FIELD_LABELS: Record<keyof LeadProfile, string> = {
  firstName: "nombres",
  lastName: "apellidos",
  company: "empresa",
  email: "correo",
  need: "detalle de la solicitud"
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

function normalizeProjectKey(value: string | null | undefined) {
  return String(value ?? "").trim().toLowerCase();
}

function normalizeProjectStatusSearchText(value: string | null | undefined) {
  return normalizeText(String(value ?? ""))
    .replace(/[^a-z0-9\s_-]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseConfiguredProjectStatusEntriesText(text: string) {
  return String(text ?? "")
    .split(/\r?\n\s*\r?\n+/)
    .map((paragraph) =>
      paragraph
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#"))
        .join(" ")
    )
    .map((paragraph) => sanitizeValue(paragraph, 900))
    .filter((paragraph): paragraph is string => Boolean(paragraph))
    .map((paragraph): ConfiguredProjectStatusEntry | null => {
      const match = paragraph.match(/^([^:]{2,180})\s*:\s*(.+)$/);
      if (!match?.[1] || !match?.[2]) return null;

      const rawHeader = sanitizeValue(match[1], 180);
      if (!rawHeader) return null;

      const aliasMatch = rawHeader.match(/^(.*?)\s*\((.*?)\)\s*$/);
      const name = sanitizeValue(aliasMatch?.[1] ?? rawHeader, 120);
      if (!name) return null;

      const aliases = aliasMatch?.[2]
        ? aliasMatch[2]
            .split(",")
            .map((alias) => sanitizeValue(alias, 120))
            .filter((alias): alias is string => Boolean(alias))
        : [];

      return {
        name,
        aliases: Array.from(new Set([name, ...aliases])),
        statusParagraph: sanitizeValue(match[2], 700)
      };
    })
    .filter((item): item is ConfiguredProjectStatusEntry => Boolean(item));
}

function normalizeText(value: string) {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function toIsoDate(value: Date) {
  const year = value.getFullYear();
  const month = String(value.getMonth() + 1).padStart(2, "0");
  const day = String(value.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function spanishWeekdayIndex(value: string | null | undefined) {
  const normalized = normalizeText(String(value ?? ""));
  if (normalized === "lunes") return 1;
  if (normalized === "martes") return 2;
  if (normalized === "miercoles") return 3;
  if (normalized === "jueves") return 4;
  if (normalized === "viernes") return 5;
  if (normalized === "sabado") return 6;
  if (normalized === "domingo") return 0;
  return null;
}

function inferDateFromWeekday(dayName: string, text: string) {
  const targetWeekday = spanishWeekdayIndex(dayName);
  if (targetWeekday === null) return null;

  const normalizedText = normalizeText(text);
  const nextWeekBias =
    normalizedText.includes("proxima semana") || normalizedText.includes("la otra semana");

  const now = new Date();
  const currentWeekday = now.getDay();
  let delta = (targetWeekday - currentWeekday + 7) % 7;
  if (nextWeekBias) delta += 7;

  const inferred = new Date(now);
  inferred.setDate(now.getDate() + delta);
  return toIsoDate(inferred);
}

function spanishWeekdayName(value: Date) {
  return ["Domingo", "Lunes", "Martes", "Miercoles", "Jueves", "Viernes", "Sabado"][value.getDay()] ?? null;
}

function inferRelativeMeetingDate(text: string) {
  const normalizedText = normalizeText(text);
  let delta: number | null = null;

  if (/\bpasado\s+manana\b/.test(normalizedText)) {
    delta = 2;
  } else if (/\bmanana\b/.test(normalizedText)) {
    delta = 1;
  } else if (/\bhoy\b/.test(normalizedText)) {
    delta = 0;
  }

  if (delta === null) return null;

  const inferred = new Date();
  inferred.setDate(inferred.getDate() + delta);
  return {
    meetingDay: spanishWeekdayName(inferred),
    meetingDate: toIsoDate(inferred)
  };
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

function looksLikePersonName(value: string | null | undefined) {
  const normalized = sanitizeValue(value, 180);
  if (!normalized) return false;
  if (/@|\d/.test(normalized)) return false;

  const blocked = new Set([
    "con",
    "ustedes",
    "luxisoft",
    "tercero",
    "terceros",
    "ticket",
    "soporte",
    "servicio",
    "proyecto",
    "para",
    "algo",
    "existente",
    "empresa",
    "emprendimiento",
    "tienda",
    "virtual",
    "producto",
    "productos",
    "correo",
    "gmail",
    "semana",
    "dia",
    "viernes",
    "sabado",
    "domingo",
    "llamada",
    "tarde",
    "manana",
    "noche"
  ]);

  const tokens = normalized
    .split(" ")
    .map((item) => normalizeText(item))
    .filter(Boolean);
  if (tokens.length < 2 || tokens.length > 5) return false;
  if (tokens.some((item) => blocked.has(item))) return false;
  return tokens.every((item) => /^[a-z]+$/i.test(item));
}

function looksLikeStandaloneNameMessage(value: string | null | undefined) {
  const compact = sanitizeValue(value, 180);
  if (!compact) return false;

  const tokens = tokenizeNormalizedWords(compact);
  if (tokens.length < 2 || tokens.length > 4) return false;
  if (tokens.some((token) => STANDALONE_NAME_BLOCKED_TOKENS.has(token))) return false;
  if (tokens.some((token) => token.length < 2)) return false;

  return looksLikePersonName(tokens.join(" "));
}

function isKnownNonAnswerReply(value: string | null | undefined) {
  const normalized = normalizeText(String(value ?? ""));
  if (!normalized) return true;

  if (POST_MEETING_COURTESY_KEYWORDS.some((item) => normalized === normalizeText(item))) {
    return true;
  }

  return [
    "si",
    "no",
    "claro",
    "obvio",
    "correcto",
    "confirmado",
    "no se",
    "nose",
    "ninguno",
    "ninguna",
    "n/a",
    "na"
  ].includes(normalized);
}

function looksLikePromptedNamePart(value: string | null | undefined) {
  const compact = sanitizeValue(value, 120);
  if (!compact || isKnownNonAnswerReply(compact) || /[?!@0-9]/.test(compact)) return false;

  const tokens = tokenizeNormalizedWords(compact);
  if (tokens.length < 1 || tokens.length > 3) return false;
  if (tokens.some((token) => STANDALONE_NAME_BLOCKED_TOKENS.has(token))) return false;
  return tokens.every((token) => /^[a-z]+$/i.test(token));
}

function looksLikePromptedCompanyAnswer(value: string | null | undefined) {
  const compact = sanitizeValue(value, 140);
  if (!compact || isKnownNonAnswerReply(compact) || /[?!@]/.test(compact)) return false;

  const tokens = tokenizeNormalizedWords(compact);
  if (tokens.length < 1 || tokens.length > 6) return false;

  const blocked = new Set([
    "es",
    "era",
    "fue",
    "soy",
    "somos",
    "para",
    "proyecto",
    "necesito",
    "quiero",
    "busco",
    "soporte",
    "ayuda",
    "error",
    "falla",
    "app",
    "aplicacion",
    "pagina",
    "web",
    "ecommerce",
    "servicio",
    "ustedes",
    "luxisoft",
    "terceros",
    "tercero",
    "correo",
    "gmail"
  ]);

  return !tokens.some((token) => blocked.has(token));
}

function looksLikePromptedNeedAnswer(value: string | null | undefined) {
  const compact = sanitizeValue(value, 220);
  if (!compact || isKnownNonAnswerReply(compact) || /[?@]/.test(compact)) return false;
  return tokenizeNormalizedWords(compact).length <= 28;
}

function applyPendingLeadFieldAnswer(
  profile: LeadProfile,
  message: string,
  pendingLeadField: keyof LeadProfile | null
) {
  if (!pendingLeadField) return profile;
  if (sanitizeValue(profile[pendingLeadField], pendingLeadField === "need" ? 220 : 140)) {
    return profile;
  }

  const compact = sanitizeValue(message, pendingLeadField === "need" ? 220 : 140);
  if (!compact || isKnownNonAnswerReply(compact) || detectSupportOwnership(compact)) {
    return profile;
  }

  if (pendingLeadField === "email") {
    const email = extractEmail(compact);
    return email ? { ...profile, email } : profile;
  }

  if (pendingLeadField === "firstName" && looksLikePromptedNamePart(compact)) {
    return { ...profile, firstName: titleCase(compact) };
  }

  if (pendingLeadField === "lastName" && looksLikePromptedNamePart(compact)) {
    return { ...profile, lastName: titleCase(compact) };
  }

  if (pendingLeadField === "company" && looksLikePromptedCompanyAnswer(compact)) {
    return { ...profile, company: sanitizeValue(compact, 140) };
  }

  if (pendingLeadField === "need" && looksLikePromptedNeedAnswer(compact)) {
    return { ...profile, need: sanitizeValue(compact, 220) };
  }

  return profile;
}

function applyPersonNameToLead(profile: LeadProfile, fullName: string) {
  const compact = sanitizeValue(fullName, 180);
  if (!compact || !looksLikePersonName(compact)) return profile;

  const tokens = compact.split(" ").filter(Boolean);
  if (tokens.length < 2) return profile;

  const firstName = titleCase(tokens[0]);
  const lastName = titleCase(tokens.slice(1).join(" "));
  return {
    ...profile,
    firstName: firstName ?? profile.firstName,
    lastName: lastName ?? profile.lastName
  };
}

function ensureKnownProjectKey(value: string | null | undefined) {
  const normalized = normalizeProjectKey(value);
  if (!normalized) return null;
  const activeProject = normalizeProjectKey(env.defaultProject) || "luxisoft";
  return normalized === activeProject ? normalized : null;
}

function loadConfiguredProjectStatusEntries(projectKey: string) {
  const normalizedProjectKey = normalizeProjectKey(projectKey) || env.defaultProject;
  const now = Date.now();
  const cached = projectStatusEntryCache.get(normalizedProjectKey);
  if (cached && cached.loadedAt + PROJECT_STATUS_CACHE_TTL_MS > now) {
    return cached.entries;
  }

  try {
    const filePath = path.join(resolveAgentsDir(), normalizedProjectKey, "project_statuses.txt");
    const raw = readFileSync(filePath, "utf8");
    const entries = parseConfiguredProjectStatusEntriesText(raw);

    projectStatusEntryCache.set(normalizedProjectKey, {
      loadedAt: now,
      entries
    });
    return entries;
  } catch {
    projectStatusEntryCache.set(normalizedProjectKey, {
      loadedAt: now,
      entries: []
    });
    return [];
  }
}

function findConfiguredProjectMention(message: string, projectKey: string) {
  const normalizedMessage = normalizeProjectStatusSearchText(message);
  if (!normalizedMessage) return null;

  for (const entry of loadConfiguredProjectStatusEntries(projectKey)) {
    for (const alias of entry.aliases) {
      const normalizedAlias = normalizeProjectStatusSearchText(alias);
      if (!normalizedAlias) continue;
      if (normalizedMessage === normalizedAlias) return entry.name;

      const escapedAlias = normalizedAlias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const aliasRegex = new RegExp(`(^|\\s)${escapedAlias}($|\\s)`, "i");
      if (aliasRegex.test(normalizedMessage)) {
        return entry.name;
      }
    }
  }

  return null;
}

function findConfiguredProjectByName(name: string | null | undefined, projectKey: string) {
  const normalizedTarget = normalizeProjectStatusSearchText(name);
  if (!normalizedTarget) return null;

  return (
    loadConfiguredProjectStatusEntries(projectKey).find((entry) =>
      entry.aliases.some((alias) => normalizeProjectStatusSearchText(alias) === normalizedTarget)
    ) ?? null
  );
}

function findConversationProjectHint(state: ConversationState, projectKey: string) {
  const byCompany = findConfiguredProjectByName(state.lead.company, projectKey);
  if (byCompany) return byCompany.name;

  const recentUserMessages = state.history
    .filter((item) => item.role === "user")
    .slice(-8)
    .reverse();

  for (const item of recentUserMessages) {
    const matched = findConfiguredProjectMention(item.text, projectKey);
    if (matched) return matched;
  }

  return null;
}

function hasConfiguredProjectStatusSignal(normalized: string) {
  return /(?:estado|avance|progreso|seguimiento|situacion|estatus|actualizacion|como va|como sigue|en que va|en que estado)/i.test(
    normalized
  );
}

function hasConfiguredProjectInfoSignal(normalized: string) {
  return /(?:informacion|detalle|detalles|quiero\s+saber|necesito\s+informacion|acerca\s+de|sobre)/i.test(
    normalized
  );
}

function hasConfiguredProjectOngoingSignal(normalized: string) {
  return /(?:proyecto\s+que\s+empezamos|proyecto\s+que\s+estan\s+realizando|estan\s+realizando|estan\s+trabajando|negocio\s+llamado|llamado\s+[a-z0-9_-]+)/i.test(
    normalized
  );
}

function hasConfiguredProjectContactSignal(normalized: string) {
  return /(?:necesito\s+(?:al|a la)|hablar\s+con|comunicarme\s+con|pasame\s+con|quiero\s+hablar\s+con)/i.test(
    normalized
  );
}

function hasGenericConfiguredProjectReference(normalized: string) {
  return /(?:la tienda|el proyecto|la web|la pagina|la app|el ecommerce|ese proyecto|esa tienda|esa web|esa pagina|esa app|ese ecommerce|mi tienda|mi proyecto|mi web|mi pagina|mi app|mi ecommerce)/i.test(
    normalized
  );
}

function formatConfiguredProjectStatusReply(projectName: string, projectKey: string) {
  const entry = findConfiguredProjectByName(projectName, projectKey);
  if (!entry?.statusParagraph) {
    return `No tengo un estado actualizado cargado para ${projectName}. Si quieres, puedo escalar la consulta con nuestro equipo.`;
  }

  return `El estado actual de ${entry.name} es el siguiente: ${entry.statusParagraph}`;
}

function detectConfiguredProjectStatusInquiry(
  message: string,
  state: ConversationState,
  projectKey: string
) {
  const matchedProject = findConfiguredProjectMention(message, projectKey);
  if (matchedProject && state.awaitingProjectStatusName) {
    return matchedProject;
  }

  const normalized = normalizeText(message);
  const statusSignal = hasConfiguredProjectStatusSignal(normalized);
  const infoSignal = hasConfiguredProjectInfoSignal(normalized);
  const ongoingSignal = hasConfiguredProjectOngoingSignal(normalized);
  const contactSignal = hasConfiguredProjectContactSignal(normalized);
  const genericProjectReference = hasGenericConfiguredProjectReference(normalized);

  if (matchedProject && (statusSignal || infoSignal || ongoingSignal || contactSignal)) {
    return matchedProject;
  }

  if (!(statusSignal || infoSignal || ongoingSignal || contactSignal || genericProjectReference)) {
    return null;
  }

  return findConversationProjectHint(state, projectKey);
}

function shouldAskConfiguredProjectStatusName(
  message: string,
  state: ConversationState,
  projectKey: string
) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  if (detectConfiguredProjectStatusInquiry(message, state, projectKey)) return false;

  const statusLikeSignal =
    hasConfiguredProjectStatusSignal(normalized) || hasConfiguredProjectOngoingSignal(normalized);
  if (statusLikeSignal) {
    return true;
  }

  return hasConfiguredProjectInfoSignal(normalized) && hasGenericConfiguredProjectReference(normalized);
}

function formatConfiguredProjectNameQuestion() {
  return "Claro. Para revisar el estado, indicame por favor el nombre del proyecto o negocio.";
}

function formatConfiguredProjectNameRetry() {
  return "Aun no ubico el proyecto. Indicame por favor el nombre exacto del proyecto o negocio para revisar su estado.";
}

function formatFieldList(labels: string[]) {
  if (labels.length === 0) return "";
  if (labels.length === 1) return labels[0] ?? "";
  if (labels.length === 2) return `${labels[0]} y ${labels[1]}`;
  return `${labels.slice(0, -1).join(", ")} y ${labels[labels.length - 1]}`;
}

function containsKeyword(text: string, keywords: string[]) {
  const normalized = normalizeText(text);
  return keywords.some((keyword) => normalized.includes(normalizeText(keyword)));
}

function tokenizeNormalizedWords(value: string) {
  return normalizeText(value)
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .map((item) => item.trim())
    .filter(Boolean);
}

function isGreetingOnlyMessage(message: string) {
  const tokens = tokenizeNormalizedWords(message);
  if (!tokens.length) return true;
  const meaningfulTokens = tokens.filter((token) => !GREETING_TOKENS.has(token));
  return meaningfulTokens.length === 0;
}

function hasNeedSignalInMessage(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  if (containsKeyword(normalized, BUY_KEYWORDS)) return true;
  return NEED_SIGNAL_REGEX.test(normalized);
}

function hasSupportSignal(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  if (containsKeyword(normalized, SUPPORT_KEYWORDS)) return true;
  return SUPPORT_SIGNAL_REGEX.test(normalized);
}

function stripLeadingGreeting(text: string) {
  let output = text.trim();
  const greetingRegex =
    /^(?:hola|buen(?:os)?\s+dias|buen\s+dia|buenas\s+tardes|buenas\s+noches|saludos?)\s*[,!:.;\-]?\s*/i;

  for (let i = 0; i < 2; i += 1) {
    const next = output.replace(greetingRegex, "").trimStart();
    if (next === output) break;
    output = next;
  }

  return output;
}

function extractEmail(text: string) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function leadFieldMaxLength(field: keyof LeadProfile) {
  return field === "need" ? 220 : 140;
}

function splitLeadMessageSegments(message: string) {
  const raw = String(message ?? "");
  const segments = raw
    .split(/\r?\n+/)
    .map((item) => item.trim())
    .filter(Boolean);

  if (segments.length > 0) return segments;

  const compact = raw.trim();
  return compact ? [compact] : [];
}

function resolvePendingLeadField(profile: LeadProfile, pendingLeadField: keyof LeadProfile | null) {
  if (!pendingLeadField) return null;

  const startIndex = LEAD_PROGRESS_FIELDS.indexOf(pendingLeadField);
  const fields =
    startIndex >= 0 ? LEAD_PROGRESS_FIELDS.slice(startIndex) : LEAD_PROGRESS_FIELDS;

  for (const field of fields) {
    if (!sanitizeValue(profile[field], leadFieldMaxLength(field))) {
      return field;
    }
  }

  return null;
}

function updateLeadProfileFromSegment(
  profile: LeadProfile,
  message: string,
  pendingLeadField: keyof LeadProfile | null = null
): LeadProfile {
  const next: LeadProfile = { ...profile };
  const text = String(message ?? "");
  const normalizedText = normalizeText(text);

  const email = extractEmail(text);
  if (email) next.email = email;

  const fullName = text.match(
    /(?:mi nombre es|me llamo|soy)\s+([A-Za-z\u00C0-\u017F]+(?:\s+[A-Za-z\u00C0-\u017F]+){1,4})/i
  );
  if (fullName?.[1]) {
    const updated = applyPersonNameToLead(next, fullName[1]);
    next.firstName = updated.firstName;
    next.lastName = updated.lastName;
  }

  const explicitName = text.match(/(?:nombres?\s*(?:son|es)?|nombre(?: completo)?)\s*[:\-]?\s*([^\n,.;]+)/i);
  if (explicitName?.[1] && looksLikePersonName(explicitName[1])) {
    const updated = applyPersonNameToLead(next, explicitName[1]);
    next.firstName = updated.firstName;
    next.lastName = updated.lastName;
  }

  const standaloneName = sanitizeValue(text, 180);
  if (standaloneName && looksLikeStandaloneNameMessage(standaloneName) && !next.firstName) {
    const updated = applyPersonNameToLead(next, standaloneName);
    next.firstName = updated.firstName;
    next.lastName = updated.lastName;
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

  const ambiguousNameField = text.match(/(?:el nombre es|nombre es)\s*([^\n,.;]+)/i);
  if (ambiguousNameField?.[1]) {
    const candidate = sanitizeValue(ambiguousNameField[1], 140);
    if (looksLikePersonName(candidate)) {
      const updated = applyPersonNameToLead(next, candidate ?? "");
      next.firstName = updated.firstName;
      next.lastName = updated.lastName;
    } else if (!next.company) {
      next.company = candidate;
    }
  }

  const fromPendingField = applyPendingLeadFieldAnswer(next, text, pendingLeadField);
  next.firstName = fromPendingField.firstName;
  next.lastName = fromPendingField.lastName;
  next.company = fromPendingField.company;
  next.email = fromPendingField.email;
  next.need = fromPendingField.need;

  if (!next.company) {
    const bareBrand = text.match(/^(?:es|soy)\s+([A-Za-z0-9][A-Za-z0-9\s_-]{1,60})$/i);
    if (
      bareBrand?.[1] &&
      !looksLikePersonName(bareBrand[1]) &&
      /(?:empresa|emprendimiento|negocio|marca|nombre)/i.test(normalizedText)
    ) {
      next.company = sanitizeValue(bareBrand[1], 140);
    }
  }

  const needField = text.match(
    /(?:necesito|quiero|quisiera|busco|requiero|necesitaria|me interesa|me gustaria|deseo|estoy interesad[oa] en|interesad[oa] en)\s+([^.!?\n]+)/i
  );
  if (needField?.[1]) {
    next.need = sanitizeValue(needField[1], 220);
  }

  if (!sanitizeValue(next.need, 220) && hasNeedSignalInMessage(text) && !isGreetingOnlyMessage(text)) {
    const withoutGreeting = text
      .replace(
        /^(?:hola|buen(?:os)?(?:\s+dias)?|buenas(?:\s+tardes|\s+noches)?|saludos?)\s*[,:\-.]?\s*/i,
        ""
      )
      .trim();
    next.need = sanitizeValue(withoutGreeting || text, 220);
  }

  return next;
}

function updateLeadProfileFromMessage(
  profile: LeadProfile,
  message: string,
  pendingLeadField: keyof LeadProfile | null = null
): LeadProfile {
  const segments = splitLeadMessageSegments(message);
  if (!segments.length) return { ...profile };

  let next: LeadProfile = { ...profile };
  let activePending = pendingLeadField;

  for (const segment of segments) {
    next = updateLeadProfileFromSegment(next, segment, activePending);
    activePending = resolvePendingLeadField(next, activePending);
  }

  return next;
}

function getMissingLeadFields(profile: LeadProfile) {
  return LEAD_REQUIRED_FIELDS.filter((field) => !sanitizeValue(profile[field], 220));
}

function getMissingSupportFields(profile: LeadProfile) {
  return SUPPORT_REQUIRED_FIELDS.filter((field) => !sanitizeValue(profile[field], 220));
}

function resolveNextMeetingQuestion(nextMeetingField: SupportFieldKey | MeetingFieldKey | null) {
  if (!nextMeetingField) return null;
  if (nextMeetingField in LEAD_FIELD_QUESTIONS) {
    return LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey];
  }
  return MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey] ?? null;
}

function updateMeetingProfileFromMessage(profile: MeetingProfile, message: string, lead: LeadProfile): MeetingProfile {
  const next: MeetingProfile = { ...profile };
  const text = String(message ?? "");
  const relativeDate = inferRelativeMeetingDate(text);

  const dayMatch = text.match(
    /\b(lunes|martes|miercoles|miércoles|jueves|viernes|sabado|sábado|domingo)\b/i
  );
  if (dayMatch?.[1]) {
    next.meetingDay = titleCase(dayMatch[1]);
  } else if (relativeDate?.meetingDay && !next.meetingDay) {
    next.meetingDay = relativeDate.meetingDay;
  }

  const dateMatch = text.match(/\b(\d{4}-\d{2}-\d{2}|\d{1,2}[\/-]\d{1,2}(?:[\/-]\d{2,4})?)\b/);
  if (dateMatch?.[1]) {
    next.meetingDate = sanitizeValue(dateMatch[1], 40);
  } else if (relativeDate?.meetingDate) {
    next.meetingDate = relativeDate.meetingDate;
  } else if (next.meetingDay) {
    const inferredDate = inferDateFromWeekday(next.meetingDay, text);
    if (inferredDate) {
      next.meetingDate = inferredDate;
    }
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

function cloneLeadProfile(profile: LeadProfile): LeadProfile {
  return {
    firstName: sanitizeValue(profile.firstName, 140),
    lastName: sanitizeValue(profile.lastName, 140),
    company: sanitizeValue(profile.company, 140),
    email: sanitizeValue(profile.email, 140),
    need: sanitizeValue(profile.need, 220)
  };
}

function cloneMeetingProfile(profile: MeetingProfile): MeetingProfile {
  return {
    meetingDay: sanitizeValue(profile.meetingDay, 80),
    meetingDate: sanitizeValue(profile.meetingDate, 80),
    meetingTime: sanitizeValue(profile.meetingTime, 80),
    meetingReason: sanitizeValue(profile.meetingReason, 220)
  };
}

function recentUserMessages(state: ConversationState, limit = 6) {
  return state.history
    .filter((item) => item.role === "user")
    .slice(-limit);
}

function recentAssistantMessages(state: ConversationState, limit = 3) {
  return state.history
    .filter((item) => item.role === "assistant")
    .slice(-limit);
}

function assistantRecentlyAskedProjectName(state: ConversationState) {
  return recentAssistantMessages(state, 2).some((item) =>
    /(?:nombre\s+exacto\s+del\s+proyecto|nombre\s+del\s+proyecto\s+o\s+negocio)/i.test(item.text)
  );
}

function findRecentSupportOwnership(state: ConversationState): SupportOwnership | null {
  if (state.supportOwnership) return state.supportOwnership;

  const recentMessages = recentUserMessages(state, 8).reverse();
  for (const item of recentMessages) {
    const detected = detectSupportOwnership(item.text);
    if (detected) return detected;
  }

  return null;
}

function hasRecentSupportContext(state: ConversationState) {
  if (state.supportOwnership || state.supportClosedAt || state.awaitingSupportOwnership || state.awaitingSupportTicketData) {
    return true;
  }

  return recentUserMessages(state, 6).some((item) => hasSupportSignal(item.text));
}

function hasRecentMeetingContext(state: ConversationState) {
  if (state.meetingClosedAt || state.awaitingMeetingData) return true;
  if (sanitizeValue(state.meeting.meetingDate, 80) || sanitizeValue(state.meeting.meetingDay, 80)) {
    return true;
  }

  return recentUserMessages(state, 6).some((item) => containsKeyword(item.text, MEETING_KEYWORDS));
}

function buildConversationCaseAnalysis(
  state: ConversationState,
  message: string,
  projectKey: string
): ConversationCaseAnalysis {
  const leadProfile = cloneLeadProfile(state.lead);
  const meetingProfile = cloneMeetingProfile(state.meeting);
  const supportMissingFields = getMissingSupportFields(leadProfile);
  const meetingMissingLeadFields = getMissingLeadFields(leadProfile);
  const meetingMissingFields = MEETING_REQUIRED_FIELDS.filter(
    (field) => !sanitizeValue(meetingProfile[field], 220)
  );
  const nextSupportField = supportMissingFields[0] ?? null;
  const nextMeetingField = meetingMissingLeadFields[0] ?? meetingMissingFields[0] ?? null;
  const normalizedMessage = normalizeText(message);
  const matchedProjectName =
    detectConfiguredProjectStatusInquiry(message, state, projectKey) ??
    (assistantRecentlyAskedProjectName(state) ? findConfiguredProjectMention(message, projectKey) : null);
  const projectNameRequired =
    !matchedProjectName &&
    (shouldAskConfiguredProjectStatusName(message, state, projectKey) ||
      assistantRecentlyAskedProjectName(state));
  const supportOwnership = detectSupportOwnership(message) ?? findRecentSupportOwnership(state);
  const supportTopic = inferSupportTopic(leadProfile.need ?? message);
  const reopenSignal = shouldReopenAfterSupport(message)
    ? "support"
    : shouldReopenAfterMeeting(message)
      ? "meeting"
      : /(?:nuevo|reiniciar|empezar\s+de\s+nuevo)/i.test(normalizedMessage)
        ? "general"
        : null;
  const notes: string[] = [];

  if (isAssistantIdentityRequest(message)) {
    return {
      ok: true,
      case_type: "identity_request",
      recommended_action: "answer_identity",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: matchedProjectName,
      project_name_required: false,
      support_closed: Boolean(state.supportClosedAt),
      meeting_closed: Boolean(state.meetingClosedAt),
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  if (isAssistantPersonalInfoRequest(message)) {
    return {
      ok: true,
      case_type: "privacy_request",
      recommended_action: "answer_privacy",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: matchedProjectName,
      project_name_required: false,
      support_closed: Boolean(state.supportClosedAt),
      meeting_closed: Boolean(state.meetingClosedAt),
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  if (matchedProjectName) {
    notes.push(`Proyecto detectado: ${matchedProjectName}.`);
    return {
      ok: true,
      case_type: "project_status",
      recommended_action: "lookup_project_status",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: matchedProjectName,
      project_name_required: false,
      support_closed: Boolean(state.supportClosedAt),
      meeting_closed: Boolean(state.meetingClosedAt),
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  if (projectNameRequired) {
    notes.push("El usuario pide estado o informacion de proyecto sin nombre suficiente.");
    return {
      ok: true,
      case_type: "project_status_name_required",
      recommended_action: "ask_project_name",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: null,
      project_name_required: true,
      support_closed: Boolean(state.supportClosedAt),
      meeting_closed: Boolean(state.meetingClosedAt),
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  const supportContext = hasSupportSignal(message) || hasRecentSupportContext(state) || Boolean(supportOwnership);
  if (supportContext) {
    if (reopenSignal && (state.supportClosedAt || state.meetingClosedAt)) {
      notes.push("El usuario pidio iniciar un nuevo caso.");
      return {
        ok: true,
        case_type: "general",
        recommended_action: "reset_case_state",
        support_topic: supportTopic,
        support_ownership: supportOwnership,
        matched_project_name: null,
        project_name_required: false,
        support_closed: Boolean(state.supportClosedAt),
        meeting_closed: Boolean(state.meetingClosedAt),
        reopen_signal: reopenSignal,
        lead_profile: leadProfile,
        meeting_profile: meetingProfile,
        support_missing_fields: supportMissingFields,
        meeting_missing_lead_fields: meetingMissingLeadFields,
        meeting_missing_fields: meetingMissingFields,
        next_support_field: nextSupportField,
        next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
        next_meeting_field: nextMeetingField,
        next_meeting_question:
          nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
            ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
            : nextMeetingField
              ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
              : null,
        notes
      };
    }

    if (state.supportClosedAt) {
      return {
        ok: true,
        case_type: "closed_support",
        recommended_action: "closed_case_notice",
        support_topic: supportTopic,
        support_ownership: supportOwnership,
        matched_project_name: null,
        project_name_required: false,
        support_closed: true,
        meeting_closed: Boolean(state.meetingClosedAt),
        reopen_signal: reopenSignal,
        lead_profile: leadProfile,
        meeting_profile: meetingProfile,
        support_missing_fields: supportMissingFields,
        meeting_missing_lead_fields: meetingMissingLeadFields,
        meeting_missing_fields: meetingMissingFields,
        next_support_field: nextSupportField,
        next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
        next_meeting_field: nextMeetingField,
        next_meeting_question:
          nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
            ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
            : nextMeetingField
              ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
              : null,
        notes
      };
    }

    if (!supportOwnership) {
      notes.push("Falta confirmar si el servicio fue con nosotros o con terceros.");
      return {
        ok: true,
        case_type: "support_ownership_required",
        recommended_action: "ask_support_ownership",
        support_topic: supportTopic,
        support_ownership: null,
        matched_project_name: null,
        project_name_required: false,
        support_closed: false,
        meeting_closed: Boolean(state.meetingClosedAt),
        reopen_signal: reopenSignal,
        lead_profile: leadProfile,
        meeting_profile: meetingProfile,
        support_missing_fields: supportMissingFields,
        meeting_missing_lead_fields: meetingMissingLeadFields,
        meeting_missing_fields: meetingMissingFields,
        next_support_field: nextSupportField,
        next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
        next_meeting_field: nextMeetingField,
        next_meeting_question:
          nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
            ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
            : nextMeetingField
              ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
              : null,
        notes
      };
    }

    if (supportOwnership === "luxisoft") {
      return {
        ok: true,
        case_type: "support_with_us",
        recommended_action: supportMissingFields.length > 0 ? "collect_support_data" : "register_support_ticket",
        support_topic: supportTopic,
        support_ownership: supportOwnership,
        matched_project_name: null,
        project_name_required: false,
        support_closed: false,
        meeting_closed: Boolean(state.meetingClosedAt),
        reopen_signal: reopenSignal,
        lead_profile: leadProfile,
        meeting_profile: meetingProfile,
        support_missing_fields: supportMissingFields,
        meeting_missing_lead_fields: meetingMissingLeadFields,
        meeting_missing_fields: meetingMissingFields,
        next_support_field: nextSupportField,
        next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
        next_meeting_field: nextMeetingField,
        next_meeting_question:
          nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
            ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
            : nextMeetingField
              ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
              : null,
        notes
      };
    }

    return {
      ok: true,
      case_type: "support_third_party",
      recommended_action:
        meetingMissingLeadFields.length > 0 || meetingMissingFields.length > 0
          ? "collect_meeting_data"
          : "schedule_meeting_request",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: null,
      project_name_required: false,
      support_closed: false,
      meeting_closed: Boolean(state.meetingClosedAt),
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  const meetingContext = containsKeyword(message, MEETING_KEYWORDS) || hasRecentMeetingContext(state);
  if (meetingContext) {
    if (reopenSignal && state.meetingClosedAt) {
      notes.push("El usuario pidio reiniciar una reunion o nueva gestion.");
      return {
        ok: true,
        case_type: "meeting_request",
        recommended_action: "reset_case_state",
        support_topic: supportTopic,
        support_ownership: supportOwnership,
        matched_project_name: null,
        project_name_required: false,
        support_closed: Boolean(state.supportClosedAt),
        meeting_closed: true,
        reopen_signal: reopenSignal,
        lead_profile: leadProfile,
        meeting_profile: meetingProfile,
        support_missing_fields: supportMissingFields,
        meeting_missing_lead_fields: meetingMissingLeadFields,
        meeting_missing_fields: meetingMissingFields,
        next_support_field: nextSupportField,
        next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
        next_meeting_field: nextMeetingField,
        next_meeting_question:
          nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
            ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
            : nextMeetingField
              ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
              : null,
        notes
      };
    }

    if (state.meetingClosedAt) {
      return {
        ok: true,
        case_type: "closed_meeting",
        recommended_action: "closed_case_notice",
        support_topic: supportTopic,
        support_ownership: supportOwnership,
        matched_project_name: null,
        project_name_required: false,
        support_closed: Boolean(state.supportClosedAt),
        meeting_closed: true,
        reopen_signal: reopenSignal,
        lead_profile: leadProfile,
        meeting_profile: meetingProfile,
        support_missing_fields: supportMissingFields,
        meeting_missing_lead_fields: meetingMissingLeadFields,
        meeting_missing_fields: meetingMissingFields,
        next_support_field: nextSupportField,
        next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
        next_meeting_field: nextMeetingField,
        next_meeting_question:
          nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
            ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
            : nextMeetingField
              ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
              : null,
        notes
      };
    }

    return {
      ok: true,
      case_type: "meeting_request",
      recommended_action:
        meetingMissingLeadFields.length > 0 || meetingMissingFields.length > 0
          ? "collect_meeting_data"
          : "schedule_meeting_request",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: null,
      project_name_required: false,
      support_closed: Boolean(state.supportClosedAt),
      meeting_closed: false,
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  if (state.supportClosedAt && !reopenSignal) {
    notes.push("Existe un ticket cerrado y el mensaje no pide reiniciarlo.");
    return {
      ok: true,
      case_type: "closed_support",
      recommended_action: "closed_case_notice",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: null,
      project_name_required: false,
      support_closed: true,
      meeting_closed: Boolean(state.meetingClosedAt),
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  if (state.meetingClosedAt && !reopenSignal) {
    notes.push("Existe una reunion cerrada y el mensaje no pide reiniciarla.");
    return {
      ok: true,
      case_type: "closed_meeting",
      recommended_action: "closed_case_notice",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: null,
      project_name_required: false,
      support_closed: Boolean(state.supportClosedAt),
      meeting_closed: true,
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  if (hasNeedSignalInMessage(message) || assistantMessageCount(state) === 0 || sanitizeValue(leadProfile.need, 220)) {
    return {
      ok: true,
      case_type: "sales_or_discovery",
      recommended_action: "continue_sales_discovery",
      support_topic: supportTopic,
      support_ownership: supportOwnership,
      matched_project_name: null,
      project_name_required: false,
      support_closed: Boolean(state.supportClosedAt),
      meeting_closed: Boolean(state.meetingClosedAt),
      reopen_signal: reopenSignal,
      lead_profile: leadProfile,
      meeting_profile: meetingProfile,
      support_missing_fields: supportMissingFields,
      meeting_missing_lead_fields: meetingMissingLeadFields,
      meeting_missing_fields: meetingMissingFields,
      next_support_field: nextSupportField,
      next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
      next_meeting_field: nextMeetingField,
      next_meeting_question:
        nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
          ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
          : nextMeetingField
            ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
            : null,
      notes
    };
  }

  return {
    ok: true,
    case_type: "general",
    recommended_action: "general_reply",
    support_topic: supportTopic,
    support_ownership: supportOwnership,
    matched_project_name: null,
    project_name_required: false,
    support_closed: Boolean(state.supportClosedAt),
    meeting_closed: Boolean(state.meetingClosedAt),
    reopen_signal: reopenSignal,
    lead_profile: leadProfile,
    meeting_profile: meetingProfile,
    support_missing_fields: supportMissingFields,
    meeting_missing_lead_fields: meetingMissingLeadFields,
    meeting_missing_fields: meetingMissingFields,
    next_support_field: nextSupportField,
    next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
    next_meeting_field: nextMeetingField,
    next_meeting_question:
      nextMeetingField && nextMeetingField in LEAD_FIELD_QUESTIONS
        ? LEAD_FIELD_QUESTIONS[nextMeetingField as SupportFieldKey]
        : nextMeetingField
          ? MEETING_FIELD_QUESTIONS[nextMeetingField as MeetingFieldKey]
          : null,
    notes
  };
}

function buildConversationStateSummary(state: ConversationState, message: string, projectKey: string) {
  const leadProfile = cloneLeadProfile(state.lead);
  const meetingProfile = cloneMeetingProfile(state.meeting);
  const supportMissingFields = getMissingSupportFields(leadProfile);
  const meetingMissingLeadFields = getMissingLeadFields(leadProfile);
  const meetingMissingFields = MEETING_REQUIRED_FIELDS.filter(
    (field) => !sanitizeValue(meetingProfile[field], 220)
  );
  const nextSupportField = supportMissingFields[0] ?? null;
  const nextMeetingField = meetingMissingLeadFields[0] ?? meetingMissingFields[0] ?? null;
  const normalizedMessage = normalizeText(message);
  const matchedProjectName = detectConfiguredProjectStatusInquiry(message, state, projectKey);
  const configuredProjectNames = loadConfiguredProjectStatusEntries(projectKey).map((entry) => entry.name);
  const supportOwnershipHint = detectSupportOwnership(message) ?? findRecentSupportOwnership(state);
  const reopenSignal = shouldReopenAfterSupport(message)
    ? "support"
    : shouldReopenAfterMeeting(message)
      ? "meeting"
      : /(?:nuevo|reiniciar|empezar\s+de\s+nuevo)/i.test(normalizedMessage)
        ? "general"
        : null;
  const snapshot = {
    project_key: state.projectKey,
    project_confirmed: state.projectConfirmed,
    current_user_message: sanitizeValue(message, 320),
    configured_project_names: configuredProjectNames,
    support_topic: state.supportTopic,
    support_ownership: state.supportOwnership,
    awaiting_support_ownership: state.awaitingSupportOwnership,
    awaiting_support_ticket_data: state.awaitingSupportTicketData,
    awaiting_meeting_data: state.awaitingMeetingData,
    awaiting_project_status_name:
      state.awaitingProjectStatusName || assistantRecentlyAskedProjectName(state),
    support_closed_at: state.supportClosedAt,
    meeting_closed_at: state.meetingClosedAt,
    lead_profile: leadProfile,
    meeting_profile: meetingProfile,
    support_missing_fields: supportMissingFields,
    next_support_field: nextSupportField,
    next_support_question: nextSupportField ? LEAD_FIELD_QUESTIONS[nextSupportField] : null,
    meeting_missing_lead_fields: meetingMissingLeadFields,
    meeting_missing_fields: meetingMissingFields,
    next_meeting_field: nextMeetingField,
    next_meeting_question: resolveNextMeetingQuestion(nextMeetingField),
    conversation_project_hint: findConversationProjectHint(state, projectKey),
    matched_project_name_in_message: matchedProjectName,
    should_ask_project_name:
      !matchedProjectName && shouldAskConfiguredProjectStatusName(message, state, projectKey),
    message_signals: {
      project_status_signal: hasConfiguredProjectStatusSignal(normalizedMessage),
      project_info_signal: hasConfiguredProjectInfoSignal(normalizedMessage),
      project_ongoing_signal: hasConfiguredProjectOngoingSignal(normalizedMessage),
      generic_project_reference: hasGenericConfiguredProjectReference(normalizedMessage),
      support_signal: hasSupportSignal(message),
      meeting_signal: containsKeyword(message, MEETING_KEYWORDS),
      need_signal: hasNeedSignalInMessage(message),
      support_ownership_hint: supportOwnershipHint,
      reopen_signal: reopenSignal
    },
    recent_user_messages: recentUserMessages(state, 6).map((item) => item.text),
    recent_assistant_messages: recentAssistantMessages(state, 4).map((item) => item.text)
  };

  return JSON.stringify(snapshot, null, 2);
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
  const style = nextReplyStyle(state);

  const linkPolicy: LinkPolicy = asksLinks
    ? "links_if_requested"
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
  const withoutGreeting = stripLeadingGreeting(trimmed);
  const body = withoutGreeting || trimmed;
  return `Hola, soy ${ASSISTANT_NAME}, asistente de ${ASSISTANT_COMPANY}. Encantada de ayudarte.\n${body}`;
}

function normalizeAssistantPlainText(reply: string) {
  const cleaned = String(reply ?? "")
    .replace(/\*\*(.*?)\*\*/g, "$1")
    .replace(/\*(.*?)\*/g, "$1")
    .replace(/`([^`]+)`/g, "$1")
    .split(/\r?\n+/)
    .map((line) =>
      line
        .trim()
        .replace(/^[-*•]+\s*/u, "")
        .replace(/^\d+\.\s*/, "")
    )
    .filter(Boolean)
    .join(" ")
    .replace(/\s+([,.;!?])/g, "$1")
    .replace(/([¿¡])\s+/g, "$1")
    .replace(/\s+/g, " ")
    .trim();

  return cleaned;
}

function finalizeAssistantReply(state: ConversationState, reply: string, plan: ReplyPlan) {
  state.lastReplyStyle = plan.style;
  return normalizeAssistantPlainText(maybeIdentityIntro(state, reply)).slice(0, MAX_RESPONSE_CHARS);
}

function finalizeFallbackReply(state: ConversationState, reply: string, plan: ReplyPlan) {
  state.lastReplyStyle = plan.style;
  return normalizeAssistantPlainText(reply).slice(0, MAX_RESPONSE_CHARS);
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
      "- servicio digital que necesitas",
      "- objetivo principal",
      "- si buscas implementacion, soporte o cotizacion"
    ].join("\n");
  }

  if (plan.style === "steps") {
    return [
      "Para avanzar rapido:",
      "1. Dime que servicio digital necesitas.",
      "2. Cuentame el objetivo que quieres lograr.",
      "3. Te explico como LUXISOFT puede ayudarte."
    ].join("\n");
  }

  if (plan.style === "question") {
    return "Para ayudarte mejor, que servicio digital necesitas y que objetivo quieres lograr primero?";
  }

  return "Para ayudarte mejor, cuentame que servicio digital necesitas y que objetivo quieres resolver.";
}

function formatOperationalFallbackReply(state: ConversationState, plan: ReplyPlan) {
  const topic = state.supportTopic ?? "soporte general";

  if (state.awaitingSupportOwnership) {
    return formatSupportOwnershipQuestion(plan, topic);
  }

  if (state.awaitingSupportTicketData) {
    return (
      buildSupportCollectionPrompt(state, false, plan, topic) ??
      "Cuentame brevemente que necesitas y continuo ayudandote."
    );
  }

  if (state.awaitingMeetingData) {
    return (
      buildMeetingCollectionPrompt(state, false, plan) ??
      "Cuentame brevemente que necesitas y continuo ayudandote."
    );
  }

  if (assistantMessageCount(state) === 0) {
    return formatInitialDiscoveryReply(plan);
  }

  return "Cuentame brevemente que necesitas y continuo ayudandote.";
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

function shouldReopenAfterMeeting(message: string) {
  const normalized = normalizeText(message);
  return REOPEN_AFTER_MEETING_KEYWORDS.some((item) => normalized.includes(normalizeText(item)));
}

function shouldReopenAfterSupport(message: string) {
  const normalized = normalizeText(message);
  return REOPEN_AFTER_SUPPORT_KEYWORDS.some((item) => normalized.includes(normalizeText(item)));
}

function isPostMeetingCourtesyMessage(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) return false;
  if (normalized.includes("?")) return false;

  const matched = POST_MEETING_COURTESY_KEYWORDS.some((item) =>
    normalized.includes(normalizeText(item))
  );
  if (!matched) return false;

  const tokens = normalized.split(/\s+/).filter(Boolean);
  return tokens.length <= 10;
}

function inferSupportTopic(message: string) {
  const normalized = normalizeText(message);
  if (!normalized) return "soporte general";
  if (/(cotizacion|cotizar|presupuesto)/i.test(normalized)) return "cotizacion";
  if (/(comprar|compra|adquirir|contratar)/i.test(normalized)) return "compra";
  if (/(aplicacion|app|android|ios)/i.test(normalized)) return "aplicacion";
  if (/(servicio|servicios)/i.test(normalized)) return "servicio";
  if (/(soporte|problema|falla|error|incidencia)/i.test(normalized)) return "soporte";
  return "soporte general";
}

function detectSupportOwnership(message: string): SupportOwnership | null {
  const normalized = normalizeText(message);
  if (!normalized) return null;

  if (
    /(?:no\s+fue\s+con\s+(?:ustedes|nosotros|luxisoft)|no\s+con\s+(?:ustedes|nosotros|luxisoft)|con\s+terceros?|otro\s+proveedor|otra\s+empresa|externo|externa|freelancer|agencia\s+externa|tercerizado)/i.test(
      normalized
    )
  ) {
    return "third_party";
  }

  if (
    /(?:con\s+(?:ustedes|nosotros|luxisoft)|fue\s+con\s+(?:ustedes|nosotros|luxisoft)|lo\s+hizo\s+luxisoft|lo\s+hizo\s+nuestro\s+equipo|lo\s+hizo\s+su\s+equipo|desarrollado\s+por\s+(?:ustedes|nosotros|nuestro\s+equipo)|implementado\s+por\s+(?:ustedes|nosotros|nuestro\s+equipo))/i.test(
      normalized
    )
  ) {
    return "luxisoft";
  }

  return null;
}

function formatSupportOwnershipQuestion(plan: ReplyPlan, topic: string) {
  if (plan.style === "steps") {
    return [
      `Antes de seguir con ${topic}, confirma esto:`,
      "1. El servicio fue desarrollado o implementado por nuestro equipo.",
      "2. O fue desarrollado/implementado por terceros.",
      "Cual de los dos casos aplica?"
    ].join("\n");
  }

  if (plan.style === "bullets") {
    return [
      `Antes de continuar con ${topic}, necesito confirmar:`,
      "- Fue un servicio con nosotros",
      "- Fue un servicio de terceros",
      "Cual aplica en tu caso?"
    ].join("\n");
  }

  return `Antes de continuar con ${topic}, confirmame algo: ese servicio fue adquirido con nosotros o con un tercero?`;
}

function buildMeetingCollectionPrompt(state: ConversationState, firstInteraction: boolean, plan: ReplyPlan) {
  const { missingLead, missingMeeting } = getMissingMeetingFields(state);
  const nextLead = missingLead[0] ?? null;
  const nextMeeting = missingMeeting[0] ?? null;
  const nextQuestion = nextLead ? LEAD_FIELD_QUESTIONS[nextLead] : nextMeeting ? MEETING_FIELD_QUESTIONS[nextMeeting] : null;
  if (!nextQuestion) return null;
  const totalMissing = missingLead.length + missingMeeting.length;
  const thirdPartySupportQuote = firstInteraction && state.supportOwnership === "third_party";
  const shouldSendChecklist = firstInteraction && totalMissing >= 4;

  if (shouldSendChecklist) {
    if (plan.style === "steps") {
      return [
        ...(thirdPartySupportQuote
          ? ["Como el servicio actual es de terceros, agendemos reunion para cotizar el soporte."]
          : []),
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
      ...(thirdPartySupportQuote
        ? ["Como el servicio actual es de terceros, agendemos reunion para cotizar el soporte."]
        : []),
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

function buildSupportCollectionPrompt(
  state: ConversationState,
  firstInteraction: boolean,
  plan: ReplyPlan,
  topic: string
) {
  const missing = getMissingSupportFields(state.lead);
  const nextField = missing[0] ?? null;
  const nextQuestion = nextField ? LEAD_FIELD_QUESTIONS[nextField] : null;
  if (!nextQuestion) return null;

  const shouldSendChecklist = firstInteraction && missing.length >= 3;
  if (shouldSendChecklist) {
    const remainingLabels = missing
      .filter((field) => field !== nextField)
      .map((field) => SUPPORT_FIELD_LABELS[field]);
    const remainingLine = remainingLabels.length
      ? `Despues te pedire ${formatFieldList(remainingLabels)}.`
      : null;

    return [
      `Perfecto, abrire un ticket de ${topic}.`,
      remainingLine,
      nextQuestion
    ]
      .filter(Boolean)
      .join("\n");
  }

  return nextQuestion;
}

function classifyRouting(message: string, state: ConversationState): RoutingDecision {
  const support = hasSupportSignal(message);
  const buy = containsKeyword(message, BUY_KEYWORDS);
  const human = containsKeyword(message, HUMAN_KEYWORDS);
  const meeting = containsKeyword(message, MEETING_KEYWORDS);

  const mentionedProject = ensureKnownProjectKey(detectProjectByText(message));
  const currentProject = ensureKnownProjectKey(state.projectKey);
  const contextProject = state.projectConfirmed ? currentProject : null;
  const configuredStatusProject =
    !support
      ? detectConfiguredProjectStatusInquiry(
          message,
          state,
          mentionedProject ?? contextProject ?? env.defaultProject
        )
      : null;

  if (configuredStatusProject) {
    return { kind: "general" };
  }

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

function isSupportTicketDecision(decision: RoutingDecision) {
  return (
    decision.kind === "support_project" ||
    decision.kind === "support_project_unknown" ||
    decision.kind === "sales_project" ||
    decision.kind === "sales_offer_catalog"
  );
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

function resolveOpenAIBaseUrl() {
  const base = env.openaiBaseUrl.trim() || "https://api.openai.com/v1";
  return base.replace(/\/+$/, "");
}

function getProjectAgentRunner() {
  if (typeof projectAgentRunner !== "undefined") {
    return projectAgentRunner;
  }

  if (!env.openaiApiKey) {
    projectAgentRunner = null;
    return projectAgentRunner;
  }

  projectAgentRunner = new Runner({
    modelProvider: new OpenAIProvider({
      apiKey: env.openaiApiKey,
      ...(env.openaiBaseUrl ? { baseURL: resolveOpenAIBaseUrl() } : {}),
      useResponses: true
    }),
    tracingDisabled: true,
    traceIncludeSensitiveData: false
  });

  return projectAgentRunner;
}

function normalizeResponseId(value: unknown) {
  const normalized = String(value ?? "").trim();
  return normalized || null;
}

function shouldResetPreviousResponseHistory(err: any) {
  const statusCode = Number(err?.statusCode ?? err?.status ?? err?.cause?.statusCode ?? err?.cause?.status ?? 0);
  if (![400, 404].includes(statusCode)) return false;

  const details = String(
    err?.details?.error?.code ??
      err?.details?.error?.message ??
      err?.details?.message ??
      err?.error?.code ??
      err?.error?.message ??
      err?.cause?.error?.code ??
      err?.cause?.error?.message ??
      err?.message ??
      ""
  ).toLowerCase();

  return (
    details.includes("previous_response_id") ||
    details.includes("response_not_found") ||
    details.includes("invalid previous response") ||
    details.includes("conversation")
  );
}

function buildProjectAgentHistoryItems(history: ConversationState["history"]): AgentInputItem[] {
  return history
    .slice(-8)
    .map((item) => (item.role === "assistant" ? assistant(item.text) : user(item.text)));
}

function buildProjectAgentTurnAnalysisInstructions(input: {
  projectKey: string;
  conversationStateSummary: string;
}) {
  return [
    `Analiza el turno actual del proyecto ${input.projectKey}.`,
    "Debes clasificar el caso conversacional actual y devolver solo un objeto estructurado segun el esquema indicado.",
    "La clasificacion debe salir del modelo, no de herramientas externas.",
    "Prioriza seguimiento de proyecto sobre venta nueva cuando el mensaje suene a trabajo ya existente: 'informacion acerca de la tienda', 'como va el proyecto', 'la tienda que estan realizando', 'Pandapan', 'el ecommerce que hicieron'.",
    "Prioriza soporte sobre venta nueva cuando el mensaje reporta problema, error o ayuda sobre algo que hicimos nosotros.",
    "Si el mensaje contiene palabras como problema, error, falla, soporte o ayuda sobre una tienda, app, web o servicio existente, no lo clasifiques como venta nueva salvo que el usuario hable claramente de crear algo nuevo.",
    "Si el usuario pregunta por estado o informacion de un proyecto sin nombre suficiente, usa case_type=project_status_name_required y recommended_action=ask_project_name.",
    "Si el usuario menciona un proyecto conocido o el estado de un proyecto existente, usa case_type=project_status y recommended_action=lookup_project_status.",
    "Si el usuario solicita soporte y aun no esta claro si fue con nosotros o con otro proveedor, usa case_type=support_ownership_required y recommended_action=ask_support_ownership.",
    "Si el soporte es de algo hecho con nosotros, usa case_type=support_with_us y recommended_action=collect_support_data o register_support_ticket segun los datos faltantes.",
    "Si el soporte es de terceros, usa case_type=support_third_party y recommended_action=collect_meeting_data o schedule_meeting_request segun corresponda.",
    "Si ya existe un ticket o reunion cerrada y el usuario no pidio reiniciar, usa closed_case_notice.",
    "Si el usuario pide abrir un caso nuevo despues de un cierre, usa recommended_action=reset_case_state.",
    "Para soporte_ownership usa 'luxisoft' solo cuando el mensaje o el estado indiquen claramente que fue con nosotros; usa 'third_party' cuando indique otro proveedor; de lo contrario usa 'unknown'.",
    "next_question_goal debe ser una descripcion corta del siguiente dato a pedir solo si aplica. Si no aplica, usa null.",
    "Ejemplos: 'Tengo un problema con la tienda' -> support_ownership_required / ask_support_ownership.",
    "Ejemplos: 'Tengo un problema con la tienda que hicieron ustedes' -> support_with_us / collect_support_data.",
    "Ejemplos: 'Necesito informacion acerca de la tienda' -> project_status_name_required / ask_project_name.",
    "Ejemplos: 'Necesito informacion del proyecto Pandapan' -> project_status / lookup_project_status.",
    "RESUMEN_DEL_ESTADO_CONVERSACIONAL_ACTUAL:",
    input.conversationStateSummary
  ].join("\n\n");
}

function buildProjectAgentObjectiveFromAnalysis(analysis: TurnAnalysis) {
  switch (analysis.recommended_action) {
    case "lookup_project_status":
      return analysis.matched_project_name
        ? `Seguimiento de proyecto detectado para ${analysis.matched_project_name}. Usa lookup_project_status antes de responder.`
        : "Seguimiento de proyecto detectado. Usa lookup_project_status antes de responder.";
    case "ask_project_name":
      return "Consulta de seguimiento de proyecto sin nombre suficiente. Pide solo el nombre del proyecto o negocio.";
    case "ask_support_ownership":
      return "Caso de soporte detectado. Pregunta solo si fue con nosotros o con otro proveedor.";
    case "collect_support_data":
      return "Caso de soporte de algo hecho por nuestro equipo. Pide solo el siguiente dato faltante y no enumeres toda la lista.";
    case "register_support_ticket":
      return "Ya hay datos suficientes para soporte. Usa register_support_ticket antes de confirmar el registro.";
    case "collect_meeting_data":
      return "Caso orientado a reunion. Pide solo el siguiente dato faltante para agendar.";
    case "schedule_meeting_request":
      return "Ya hay datos suficientes para reunion. Usa schedule_meeting_request antes de confirmar el agendamiento.";
    case "reset_case_state":
      return "El usuario pidio iniciar un caso nuevo. Usa reset_case_state y luego continua con el nuevo caso.";
    case "closed_case_notice":
      return "Hay un caso ya cerrado y no se pidio reinicio claro. No dupliques gestiones; informa el cierre y ofrece abrir uno nuevo solo si el usuario lo pide.";
    case "continue_sales_discovery":
      return "Es una oportunidad comercial nueva. Responde segun el servicio y avanza con una sola pregunta puntual.";
    default:
      return "Analiza el caso actual y responde segun el escenario real de la conversacion usando las tools disponibles antes de confirmar acciones.";
  }
}

function buildProjectAgentInstructions(input: {
  projectPrompt: string;
  projectKey: string;
  objective?: string;
  replyPlan: ReplyPlan;
  sources: string[];
  conversationStateSummary: string;
  turnAnalysis?: TurnAnalysis | null;
}) {
  return [
    input.projectPrompt || `Eres el agente del proyecto ${input.projectKey}.`,
    `PROYECTO_ACTUAL: ${input.projectKey}`,
    "Responde en espanol claro, maximo 6 lineas si no requiere mas detalle.",
    "Escribe como una persona normal por chat: sin Markdown, sin asteriscos, sin bullets, sin listas numeradas y sin simbolos decorativos.",
    `Tu identidad comercial fija es ${ASSISTANT_NAME}, asistente de ${ASSISTANT_COMPANY}.`,
    "Cuando hables de ti, usa voz femenina.",
    `No compartas datos personales tuyos; solo puedes compartir tu nombre (${ASSISTANT_NAME}) y que trabajas en ${ASSISTANT_COMPANY}.`,
    "No abras con saludo ni presentacion al iniciar la respuesta; el sistema ya agrega la presentacion del primer turno.",
    "No repitas siempre el mismo formato. Sigue el FORMATO_DINAMICO_RECOMENDADO enviado por el sistema.",
    `FORMATO_DINAMICO_RECOMENDADO: ${describeReplyStyle(input.replyPlan.style)}`,
    "No incluyas URLs en todas las respuestas. Sigue la POLITICA_DE_ENLACES enviada por el sistema.",
    `POLITICA_DE_ENLACES: ${describeLinkPolicy(input.replyPlan.linkPolicy)}`,
    input.objective ? `OBJETIVO_DE_ATENCION_ACTUAL: ${input.objective}` : null,
    "Responde exclusivamente con informacion confirmada por herramientas y fuentes oficiales.",
    "No uses conocimiento externo ni inventes datos no confirmados por fuentes oficiales.",
    "Si necesitas confirmar detalles de servicios o funcionalidades, usa la tool scrape_project_knowledge antes de responder.",
    "Si el usuario pregunta por estado, avance o progreso actual de un proyecto, trabajo, aplicacion, pagina, o menciona un proyecto en curso ya realizado por LUXISOFT, usa la tool lookup_project_status antes de responder.",
    "Si un dato no aparece en fuentes despues de consultar tools, responde con tono comercial seguro: explica lo que si esta publicado y el siguiente paso.",
    "Evita tono de inseguridad o frases ambiguas; habla con claridad.",
    "Si necesitas mas contexto del sitio, usa los tools disponibles antes de responder.",
    "Si compartes enlaces, usa URL completa oficial.",
    "Si el usuario pide contacto humano, ofrece agendar reunion con especialista.",
    "El analisis del caso debe ocurrir dentro del agente. Decide tu misma si corresponde soporte, seguimiento de proyecto, reunion, venta, reinicio de caso o respuesta general usando el mensaje actual, el historial y RESUMEN_DEL_ESTADO_CONVERSACIONAL_ACTUAL.",
    "No dependas de una tool central de clasificacion para decidir el caso. Usa las tools para consultar informacion, extraer datos y ejecutar acciones cuando haga falta.",
    "Prioriza seguimiento de proyecto sobre venta nueva cuando el mensaje suene a trabajo ya existente: por ejemplo 'informacion acerca de la tienda', 'como va el proyecto', 'la tienda que estan realizando', 'Pandapan', 'el ecommerce que hicieron'.",
    "Prioriza soporte sobre venta nueva cuando el mensaje reporta problema, error o ayuda sobre algo que hicimos nosotros.",
    "Si el usuario pregunta por el estado o informacion de un proyecto y no menciona un nombre suficiente, pide primero el nombre del proyecto o negocio antes de consultar.",
    "Si should_ask_project_name es true en el estado conversacional, pide directamente el nombre del proyecto o negocio en una sola pregunta y no abras discovery comercial en paralelo.",
    "Si necesitas identificar mejor el servicio o perfilar una oportunidad comercial, usa classify_service_intent, extract_prospect_profile y next_intake_question.",
    "Si el usuario solicita soporte de un servicio o producto hecho por nuestro equipo y aun no esta claro, pregunta solo si fue con nosotros o con otro proveedor.",
    "Cuando hables de propiedad del servicio, prefiere 'con nosotros' y 'nuestro equipo' en vez de repetir el nombre comercial.",
    "No pidas datos que ya esten presentes en lead_profile o meeting_profile dentro del estado conversacional actual.",
    "Cuando falten datos para soporte o reunion, pide solo el siguiente dato faltante y evita enumerar toda la lista en cada turno.",
    "Si ya tienes los datos requeridos para soporte, llama register_support_ticket antes de confirmar el registro.",
    "Si register_support_ticket devuelve campos faltantes, pide solo el siguiente dato faltante.",
    "Si ya tienes los datos requeridos para reunion, llama schedule_meeting_request antes de confirmar el agendamiento.",
    "Si schedule_meeting_request devuelve campos faltantes, pide solo el siguiente dato faltante.",
    "Nunca confirmes que un ticket o una reunion quedaron registrados si no se ejecuto la tool correspondiente y esta devolvio exito.",
    "Si el caso ya esta cerrado y el usuario no pidio reiniciarlo, evita duplicar tickets o reuniones. Solo usa reset_case_state si el usuario pide abrir un caso nuevo.",
    input.turnAnalysis ? `ANALISIS_IA_PREVIO_DEL_TURNO: ${JSON.stringify(input.turnAnalysis)}` : null,
    "RESUMEN_DEL_ESTADO_CONVERSACIONAL_ACTUAL:",
    input.conversationStateSummary,
    "FUENTES_OFICIALES_DISPONIBLES:",
    input.sources.length ? input.sources.map((item) => `- ${item}`).join("\n") : "- Sin fuentes configuradas."
  ]
    .filter(Boolean)
    .join("\n\n");
}

function buildProjectAgentTools(scripts: AgentScript[], runtimeContext: AgentScriptRuntimeContext, toolsUsed: Set<string>) {
  return scripts.map((script) =>
    tool({
      name: script.name,
      description: script.description,
      parameters: script.parameters as any,
      strict: false,
      execute: async (payload) => {
        toolsUsed.add(script.name);
        const args = isRecord(payload) ? payload : ({} as Record<string, unknown>);
        return script.run(args, runtimeContext);
      },
      errorFunction: (_context, error) =>
        JSON.stringify({
          ok: false,
          error: String((error as any)?.message ?? "tool_execution_failed")
        })
    })
  );
}

function trackProjectAgentRunUsage(result: any, fallbackModel: string) {
  const rawResponses = Array.isArray(result?.rawResponses) ? result.rawResponses : [];
  for (const rawResponse of rawResponses) {
    trackOpenAIUsage({
      model:
        String(
          rawResponse?.providerData?.response?.model ??
            rawResponse?.providerData?.model ??
            fallbackModel
        ).trim() || fallbackModel,
      usage: rawResponse?.usage ?? null
    });
  }
}

async function runProjectAgentTurnAnalysis(input: {
  projectKey: string;
  model: string;
  history: ConversationState["history"];
  conversationStateSummary: string;
}) {
  const runner = getProjectAgentRunner();
  if (!runner) {
    throw new Error("openai_not_configured");
  }

  const analysisAgent = new Agent({
    name: `${input.projectKey}_turn_analysis`,
    instructions: buildProjectAgentTurnAnalysisInstructions({
      projectKey: input.projectKey,
      conversationStateSummary: input.conversationStateSummary
    }),
    model: input.model,
    outputType: TurnAnalysisSchema,
    modelSettings: {
      parallelToolCalls: false,
      text: { verbosity: "low" }
    },
    tools: []
  });

  const result = await runner.run(analysisAgent, buildProjectAgentHistoryItems(input.history), {
    maxTurns: 1
  });

  trackProjectAgentRunUsage(result, input.model);
  return TurnAnalysisSchema.parse(result.finalOutput);
}

function detectProjectByText(text: string) {
  const normalized = text.toLowerCase();
  const activeProject = normalizeProjectKey(env.defaultProject) || "luxisoft";

  if (new RegExp(`(^|\\s|\\b)(${activeProject})(\\b|\\s|$)`, "i").test(normalized)) {
    return activeProject;
  }

  const command = normalized.match(/(?:proyecto|project)\s*[:=\-]?\s*([a-z0-9_-]{2,64})/i)?.[1] ?? null;
  if (!command) return null;
  const requested = normalizeProjectKey(command) || null;
  return requested === activeProject ? requested : null;
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

function buildSupportTicketSummary(state: ConversationState, phoneE164: string) {
  const recentUserMessages = state.history
    .filter((item) => item.role === "user")
    .slice(-6)
    .map((item) => item.text.slice(0, 220));

  const contactName = `${state.lead.firstName ?? ""} ${state.lead.lastName ?? ""}`.trim();
  const topic = state.supportTopic ?? "soporte general";
  const summary = state.lead.need ?? recentUserMessages[recentUserMessages.length - 1] ?? "(sin dato)";

  return {
    topic,
    summary,
    contactName,
    contactEmail: state.lead.email ?? "",
    company: state.lead.company ?? "",
    transcript: recentUserMessages.map((msg, index) => `${index + 1}. ${msg}`),
    userPhone: phoneE164
  };
}

function getConversation(phoneE164: string, projectKey: string) {
  const existing = conversations.get(phoneE164);
  if (existing) {
    if (projectKey) existing.projectKey = projectKey;
    if (typeof existing.pendingLeadField === "undefined") {
      existing.pendingLeadField = null;
    }
    if (typeof existing.awaitingProjectStatusName !== "boolean") {
      existing.awaitingProjectStatusName = false;
    }
    if (!existing.lastReplyStyle) existing.lastReplyStyle = null;
    if (typeof existing.awaitingSupportOwnership !== "boolean") {
      existing.awaitingSupportOwnership = false;
    }
    if (!existing.supportOwnership) {
      existing.supportOwnership = null;
    }
    if (typeof existing.supportClosedAt !== "number") {
      existing.supportClosedAt = null;
    }
    if (typeof existing.awaitingSupportTicketData !== "boolean") {
      existing.awaitingSupportTicketData = false;
    }
    if (!existing.supportTopic) {
      existing.supportTopic = null;
    }
    if (typeof existing.meetingClosedAt !== "number") {
      existing.meetingClosedAt = null;
    }
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
    pendingLeadField: null,
    awaitingProjectStatusName: false,
    meeting: emptyMeetingProfile(),
    supportTopic: null,
    supportOwnership: null,
    awaitingSupportOwnership: false,
    awaitingSupportTicketData: false,
    supportClosedAt: null,
    awaitingMeetingData: false,
    meetingClosedAt: null,
    lastReplyStyle: null,
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
  state: ConversationState;
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
  const conversationStateSummary = buildConversationStateSummary(
    input.state,
    input.userMessage,
    project.project_key
  );

  const runtimeContext: AgentScriptRuntimeContext = {
    projectKey: project.project_key,
    phoneE164: input.phoneE164,
    userMessage: input.userMessage,
    history: input.history.map((item) => ({ role: item.role, text: item.text })),
    sources: projectSources,
    conversationState: JSON.parse(conversationStateSummary),
    searchKnowledge: (query, options) =>
      searchKnowledge({
        projectKey: project.project_key,
        query,
        sources: projectSources,
        sourceUrl: options?.sourceUrl
      }),
    registerSupportTicket: async (payload) =>
      registerSupportTicketFromAgent({
        state: input.state,
        phoneE164: input.phoneE164,
        projectKey: project.project_key,
        payload
      }),
    scheduleMeetingRequest: async (payload) =>
      scheduleMeetingRequestFromAgent({
        state: input.state,
        phoneE164: input.phoneE164,
        projectKey: project.project_key,
        payload
      }),
    resetCaseState: async (payload) =>
      resetConversationCaseState({
        state: input.state,
        payload
      })
  };

  const model = env.openaiProjectModel;
  const turnAnalysis = await runProjectAgentTurnAnalysis({
    projectKey: project.project_key,
    model,
    history: input.history,
    conversationStateSummary
  });
  const analysisObjective = buildProjectAgentObjectiveFromAnalysis(turnAnalysis);
  const effectiveObjective = [analysisObjective, input.objective].filter(Boolean).join(" ");
  const toolsUsed = new Set<string>();
  const runner = getProjectAgentRunner();
  if (!runner) {
    throw new Error("openai_not_configured");
  }
  const agent = new Agent<AgentScriptRuntimeContext>({
    name: `${project.project_key}_assistant`,
    instructions: buildProjectAgentInstructions({
      projectPrompt: project.prompt,
      projectKey: project.project_key,
      objective: effectiveObjective,
      replyPlan: input.replyPlan,
      sources: projectSources,
      conversationStateSummary,
      turnAnalysis
    }),
    model,
    modelSettings: {
      parallelToolCalls: false,
      text: { verbosity: "low" }
    },
    tools: buildProjectAgentTools(project.scripts, runtimeContext, toolsUsed)
  });

  const historyInput = buildProjectAgentHistoryItems(input.history);
  const previousResponseId = normalizeResponseId(input.previousResponseId);
  let result: any;

  try {
    result = await runner.run(
      agent,
      previousResponseId ? input.userMessage : historyInput,
      {
        context: runtimeContext,
        maxTurns: Math.max(2, env.openaiAgentMaxToolSteps + 1),
        ...(previousResponseId ? { previousResponseId } : {})
      }
    );
  } catch (err: any) {
    if (!previousResponseId || !shouldResetPreviousResponseHistory(err)) {
      trackOpenAIFailure();
      trackOperationalError();
      throw err;
    }
    try {
      result = await runner.run(agent, historyInput, {
        context: runtimeContext,
        maxTurns: Math.max(2, env.openaiAgentMaxToolSteps + 1)
      });
    } catch (retryErr: any) {
      trackOpenAIFailure();
      trackOperationalError();
      throw retryErr;
    }
  }

  trackProjectAgentRunUsage(result, model);
  const autoActionReply = await maybeCompleteCriticalAgentAction({
    turnAnalysis,
    toolsUsed,
    state: input.state,
    phoneE164: input.phoneE164,
    projectKey: project.project_key
  });
  const modelReply = String(result?.finalOutput ?? "").trim();
  const answer =
    sanitizeValue(autoActionReply, MAX_RESPONSE_CHARS) ??
    (modelReply || "Cuentame brevemente que necesitas y te ayudo a orientarlo.");
  return {
    projectKey: project.project_key,
    answer: answer.slice(0, MAX_RESPONSE_CHARS),
    toolsUsed: Array.from(toolsUsed),
    responseId: normalizeResponseId(result?.lastResponseId)
  };
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

function readToolTextField(
  input: Record<string, unknown> | null | undefined,
  keys: string[],
  maxLength = 220
) {
  for (const key of keys) {
    const rawValue = input?.[key];
    const value = sanitizeValue(typeof rawValue === "string" ? rawValue : null, maxLength);
    if (value) return value;
  }
  return null;
}

function mergeLeadProfileFromToolInput(state: ConversationState, input: Record<string, unknown> | null | undefined) {
  const fullName = readToolTextField(input, ["full_name", "contact_name", "name"], 180);
  if (fullName && looksLikePersonName(fullName)) {
    const updated = applyPersonNameToLead(state.lead, fullName);
    state.lead.firstName = updated.firstName;
    state.lead.lastName = updated.lastName;
  }

  const firstName = readToolTextField(input, ["first_name", "firstName"], 120);
  const lastName = readToolTextField(input, ["last_name", "lastName"], 120);
  const company = readToolTextField(input, ["company", "business_name"], 140);
  const email = extractEmail(readToolTextField(input, ["email", "contact_email"], 180) ?? "");
  const summary = readToolTextField(input, ["summary", "need", "request_detail", "reason"], 220);

  if (firstName && looksLikePromptedNamePart(firstName)) {
    state.lead.firstName = titleCase(firstName);
  }
  if (lastName && looksLikePromptedNamePart(lastName)) {
    state.lead.lastName = titleCase(lastName);
  }
  if (company) {
    state.lead.company = company;
  }
  if (email) {
    state.lead.email = email;
  }
  if (summary) {
    state.lead.need = summary;
  }
}

function mergeMeetingProfileFromToolInput(state: ConversationState, input: Record<string, unknown> | null | undefined) {
  const meetingDay = readToolTextField(input, ["meeting_day", "day"], 80);
  const meetingDate = readToolTextField(input, ["meeting_date", "date"], 80);
  const meetingTime = readToolTextField(input, ["meeting_time", "time"], 80);
  const meetingReason = readToolTextField(input, ["meeting_reason", "reason"], 220);

  if (meetingDay) state.meeting.meetingDay = meetingDay;
  if (meetingDate) state.meeting.meetingDate = meetingDate;
  if (meetingTime) state.meeting.meetingTime = meetingTime;
  if (meetingReason) state.meeting.meetingReason = meetingReason;

  if (!sanitizeValue(state.meeting.meetingReason, 220)) {
    state.meeting.meetingReason = sanitizeValue(state.lead.need, 220);
  }
}

async function registerSupportTicketFromAgent(input: {
  state: ConversationState;
  phoneE164: string;
  projectKey: string;
  payload?: Record<string, unknown>;
}) {
  if (input.state.supportClosedAt) {
    return {
      ok: false,
      error: "support_ticket_already_closed",
      closed_at: input.state.supportClosedAt
    };
  }

  mergeLeadProfileFromToolInput(input.state, input.payload);
  const topic = readToolTextField(input.payload, ["topic"], 80) ?? input.state.supportTopic ?? inferSupportTopic(input.state.lead.need ?? "");
  input.state.supportTopic = topic;

  const missing = getMissingSupportFields(input.state.lead);
  if (missing.length > 0) {
    return {
      ok: false,
      error: "missing_fields",
      missing_fields: missing,
      next_field: missing[0] ?? null,
      next_question: missing[0] ? LEAD_FIELD_QUESTIONS[missing[0]] : null
    };
  }

  const ticket = buildSupportTicketSummary(input.state, input.phoneE164);
  const mail = await sendSupportTicketEmail({
    projectKey: input.projectKey,
    userPhone: ticket.userPhone,
    contactName: ticket.contactName,
    contactEmail: ticket.contactEmail,
    company: ticket.company,
    topic: ticket.topic,
    summary: ticket.summary,
    transcript: ticket.transcript
  });
  if (!mail.sent) {
    trackOperationalError();
  }

  input.state.awaitingSupportOwnership = false;
  input.state.awaitingSupportTicketData = false;
  input.state.awaitingMeetingData = false;
  input.state.pendingLeadField = null;
  input.state.supportOwnership = "luxisoft";
  input.state.supportClosedAt = mail.sent ? Date.now() : null;

  if (mail.sent) {
    trackSupportTicketCreated();
  }

  return {
    ok: true,
    sent: mail.sent,
    closed: mail.sent,
    support_topic: ticket.topic,
    contact_name: ticket.contactName,
    company: ticket.company,
    email: ticket.contactEmail,
    summary: ticket.summary,
    reply_hint: mail.sent
      ? "Perfecto, ya registre tu ticket de soporte y lo envie a nuestro equipo. Te daremos respuesta lo mas pronto posible."
      : "Registre tu solicitud, pero fallo el envio del ticket en este momento. Intenta nuevamente en unos minutos."
  };
}

async function scheduleMeetingRequestFromAgent(input: {
  state: ConversationState;
  phoneE164: string;
  projectKey: string;
  payload?: Record<string, unknown>;
}) {
  if (input.state.meetingClosedAt) {
    return {
      ok: false,
      error: "meeting_request_already_closed",
      closed_at: input.state.meetingClosedAt
    };
  }

  mergeLeadProfileFromToolInput(input.state, input.payload);
  mergeMeetingProfileFromToolInput(input.state, input.payload);

  const missing = getMissingMeetingFields(input.state);
  if (missing.missingLead.length > 0 || missing.missingMeeting.length > 0) {
    const nextLead = missing.missingLead[0] ?? null;
    const nextMeeting = missing.missingMeeting[0] ?? null;
    return {
      ok: false,
      error: "missing_fields",
      missing_lead_fields: missing.missingLead,
      missing_meeting_fields: missing.missingMeeting,
      next_field: nextLead ?? nextMeeting,
      next_question: nextLead
        ? LEAD_FIELD_QUESTIONS[nextLead]
        : nextMeeting
          ? MEETING_FIELD_QUESTIONS[nextMeeting]
          : null
    };
  }

  const transfer = await notifyHumanMeeting({
    projectKey: input.projectKey,
    phoneE164: input.phoneE164,
    summary: buildMeetingSummary(input.state, input.phoneE164)
  });

  const quoteEmail = await sendMeetingQuoteEmail({
    projectKey: input.projectKey,
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
  if (!quoteEmail.sent) {
    trackOperationalError();
  }

  const delivered = transfer.sent || quoteEmail.sent;

  input.state.awaitingMeetingData = false;
  input.state.awaitingSupportOwnership = false;
  input.state.awaitingSupportTicketData = false;
  input.state.pendingLeadField = null;
  input.state.meetingClosedAt = delivered ? Date.now() : null;

  if (delivered) {
    trackMeetingScheduled({
      projectKey: input.projectKey,
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
  }

  return {
    ok: delivered,
    sent: delivered,
    notified_human: transfer.sent,
    email_sent: quoteEmail.sent,
    closed: delivered,
    reply_hint: delivered
      ? "Perfecto, ya agende tu solicitud de reunion con especialista. Te contactaran con los datos registrados. Con esto dejamos cerrada esta gestion por aqui."
      : "Registre tu solicitud, pero fallo el envio al agente humano en este momento. Intenta de nuevo en unos minutos."
  };
}

async function resetConversationCaseState(input: {
  state: ConversationState;
  payload?: Record<string, unknown>;
}) {
  const target = readToolTextField(input.payload, ["target"], 40) ?? "all";
  const keepContactData = String(input.payload?.keep_contact_data ?? "true").toLowerCase() !== "false";

  if (target === "support" || target === "all") {
    input.state.awaitingSupportOwnership = false;
    input.state.awaitingSupportTicketData = false;
    input.state.supportOwnership = null;
    input.state.supportClosedAt = null;
    input.state.supportTopic = null;
  }

  if (target === "meeting" || target === "all") {
    input.state.awaitingMeetingData = false;
    input.state.meetingClosedAt = null;
    input.state.meeting = emptyMeetingProfile();
  }

  input.state.awaitingProjectStatusName = false;
  input.state.pendingLeadField = null;
  input.state.lead.need = null;

  if (!keepContactData) {
    input.state.lead = emptyLeadProfile();
  }

  return {
    ok: true,
    target,
    keep_contact_data: keepContactData,
    state: {
      lead: cloneLeadProfile(input.state.lead),
      meeting: cloneMeetingProfile(input.state.meeting),
      support_closed_at: input.state.supportClosedAt,
      meeting_closed_at: input.state.meetingClosedAt
    }
  };
}

async function maybeCompleteCriticalAgentAction(input: {
  turnAnalysis: TurnAnalysis;
  toolsUsed: Set<string>;
  state: ConversationState;
  phoneE164: string;
  projectKey: string;
}) {
  if (input.turnAnalysis.recommended_action === "register_support_ticket") {
    if (input.toolsUsed.has("register_support_ticket")) return null;
    input.toolsUsed.add("register_support_ticket");

    const ticket = await registerSupportTicketFromAgent({
      state: input.state,
      phoneE164: input.phoneE164,
      projectKey: input.projectKey
    });

    if (ticket.ok && typeof ticket.reply_hint === "string") {
      return ticket.reply_hint;
    }
    if (ticket?.error === "missing_fields" && typeof ticket.next_question === "string") {
      return ticket.next_question;
    }
    return "No pude completar el registro del ticket en este momento. Intenta nuevamente en unos minutos.";
  }

  if (input.turnAnalysis.recommended_action === "schedule_meeting_request") {
    if (input.toolsUsed.has("schedule_meeting_request")) return null;
    input.toolsUsed.add("schedule_meeting_request");

    const meeting = await scheduleMeetingRequestFromAgent({
      state: input.state,
      phoneE164: input.phoneE164,
      projectKey: input.projectKey
    });

    if (meeting.ok && typeof meeting.reply_hint === "string") {
      return meeting.reply_hint;
    }
    if (meeting?.error === "missing_fields" && typeof meeting.next_question === "string") {
      return meeting.next_question;
    }
    return "No pude completar el agendamiento en este momento. Intenta nuevamente en unos minutos.";
  }

  return null;
}

async function runSupportTicketQualification(input: {
  state: ConversationState;
  phoneE164: string;
  firstInteraction: boolean;
  replyPlan: ReplyPlan;
}) {
  const topic = input.state.supportTopic ?? "soporte general";
  const missing = getMissingSupportFields(input.state.lead);
  if (missing.length > 0) {
    input.state.pendingLeadField = missing[0] ?? null;
    const prompt = buildSupportCollectionPrompt(input.state, input.firstInteraction, input.replyPlan, topic);
    const rawReply = prompt ?? "Necesito un dato adicional para registrar tu ticket.";
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

  input.state.pendingLeadField = null;
  const ticket = buildSupportTicketSummary(input.state, input.phoneE164);
  const mail = await sendSupportTicketEmail({
    projectKey: input.state.projectKey,
    userPhone: ticket.userPhone,
    contactName: ticket.contactName,
    contactEmail: ticket.contactEmail,
    company: ticket.company,
    topic: ticket.topic,
    summary: ticket.summary,
    transcript: ticket.transcript
  });
  if (!mail.sent) {
    trackOperationalError();
  }

  input.state.awaitingSupportTicketData = false;
  input.state.supportClosedAt = mail.sent ? Date.now() : null;

  if (mail.sent) {
    trackSupportTicketCreated();
  }

  const rawReply = mail.sent
    ? "Perfecto, ya registre tu ticket de soporte y lo envie a nuestro equipo. Te daremos respuesta lo mas pronto posible."
    : "Registre tu solicitud, pero fallo el envio del ticket en este momento. Intenta nuevamente en unos minutos.";
  const reply = finalizeAssistantReply(input.state, rawReply, input.replyPlan);
  appendHistory(input.state, "assistant", reply);

  return {
    handled: true,
    projectKey: input.state.projectKey,
    reply,
    escalated: true,
    escalationSent: mail.sent
  } as AgentReply;
}

async function continueSupportFlowByOwnership(input: {
  state: ConversationState;
  phoneE164: string;
  firstInteraction: boolean;
  replyPlan: ReplyPlan;
}) {
  if (input.state.supportOwnership === "third_party") {
    input.state.awaitingSupportTicketData = false;
    input.state.awaitingMeetingData = true;
    if (!sanitizeValue(input.state.meeting.meetingReason, 220)) {
      const baseReason = sanitizeValue(input.state.lead.need, 220) ?? "Cotizar soporte para servicio de terceros";
      input.state.meeting.meetingReason = sanitizeValue(baseReason, 220);
    }
    return runMeetingQualification({
      state: input.state,
      phoneE164: input.phoneE164,
      firstInteraction: input.firstInteraction,
      replyPlan: input.replyPlan
    });
  }

  input.state.awaitingMeetingData = false;
  input.state.awaitingSupportTicketData = true;
  return runSupportTicketQualification({
    state: input.state,
    phoneE164: input.phoneE164,
    firstInteraction: input.firstInteraction,
    replyPlan: input.replyPlan
  });
}

async function runMeetingQualification(input: {
  state: ConversationState;
  phoneE164: string;
  firstInteraction: boolean;
  replyPlan: ReplyPlan;
}) {
  const missing = getMissingMeetingFields(input.state);
  if (missing.missingLead.length > 0 || missing.missingMeeting.length > 0) {
    input.state.pendingLeadField = missing.missingLead[0] ?? null;
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

  input.state.pendingLeadField = null;
  const transfer = await notifyHumanMeeting({
    projectKey: input.state.projectKey,
    phoneE164: input.phoneE164,
    summary: buildMeetingSummary(input.state, input.phoneE164)
  });

  const quoteEmail = await sendMeetingQuoteEmail({
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
  if (!quoteEmail.sent) {
    trackOperationalError();
  }

  const delivered = transfer.sent || quoteEmail.sent;

  input.state.awaitingMeetingData = false;
  input.state.meetingClosedAt = delivered ? Date.now() : null;

  const rawReply = delivered
    ? "Perfecto, ya agende tu solicitud de reunion con especialista. Te contactaran con los datos registrados. Con esto dejamos cerrada esta gestion por aqui."
    : "Registre tu solicitud, pero fallo el envio al agente humano en este momento. Intenta de nuevo en unos minutos.";
  const reply = finalizeAssistantReply(input.state, rawReply, input.replyPlan);
  appendHistory(input.state, "assistant", reply);

  if (delivered) {
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
  }

  return {
    handled: true,
    projectKey: input.state.projectKey,
    reply,
    escalated: true,
    escalationSent: delivered
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
  state.lead = updateLeadProfileFromMessage(state.lead, message, state.pendingLeadField);
  if (state.pendingLeadField && sanitizeValue(state.lead[state.pendingLeadField], 220)) {
    state.pendingLeadField = null;
  }
  state.meeting = updateMeetingProfileFromMessage(state.meeting, message, state.lead);
  const replyPlan = buildReplyPlan(state, message);

  try {
    const singleProjectKey = state.projectKey || env.defaultProject || "luxisoft";
    state.projectKey = singleProjectKey;
    state.projectConfirmed = true;
    state.pendingLeadField = null;
    state.awaitingProjectStatusName = false;

    const objective =
      "Analiza el caso actual y responde segun el escenario real de la conversacion. Decide si corresponde soporte, seguimiento de proyecto, venta, ticket, reunion, reinicio de caso o una respuesta general, usando las tools disponibles antes de confirmar acciones.";

    const resolved = await runProjectAgent({
      projectKey: singleProjectKey,
      phoneE164: phone,
      userMessage: message,
      state,
      history: state.history,
      objective,
      replyPlan,
      previousResponseId:
        state.openaiProjectPreviousResponseIds[singleProjectKey] ?? null
    });
    if (resolved.responseId) {
      state.openaiProjectPreviousResponseIds[singleProjectKey] = resolved.responseId;
    }

    state.pendingLeadField = null;
    const agentReply = finalizeAssistantReply(state, resolved.answer, replyPlan);
    appendHistory(state, "assistant", agentReply);

    return {
      handled: true,
      projectKey: state.projectKey,
      reply: agentReply,
      escalated: false,
      escalationSent: false
    };
  } catch (err: any) {
    state.pendingLeadField = null;
    const rawFallback = formatOperationalFallbackReply(state, replyPlan);
    const fallback = finalizeFallbackReply(state, rawFallback, replyPlan);
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
