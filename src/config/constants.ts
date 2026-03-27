// WhatsApp API
export const WHATSAPP_GRAPH_API_VERSION = "v20.0";

// OTP
export const OTP_CODE_LENGTH = 6;
export const OTP_EXPIRES_IN_MS = 5 * 60 * 1000;

// Message handling
export const MAX_TEXT_REPLY_CHARS = 250;

// Agent / conversation
export const KNOWLEDGE_CACHE_TTL_MS = 10 * 60 * 1000;
export const PROJECT_STATUS_CACHE_TTL_MS = 60 * 1000;
export const MAX_HISTORY_ITEMS = 12;
export const MAX_RESPONSE_CHARS = 1400;
export const MAX_SOURCE_LINKS_PER_PAGE = 20;
export const MAX_GROUNDING_SNIPPETS = 6;
export const MAX_CRAWL_PAGES_PER_SOURCE = 6;
export const MAX_CRAWL_DEPTH = 1;
export const MAX_PAGE_TEXT_CHARS = 10_000;
export const MAX_PAGE_SNIPPETS = 250;

// Agent identity
export const ASSISTANT_NAME = "Valeria";
export const ASSISTANT_COMPANY = "LUXISOFT";

// Default project knowledge sources
export const DEFAULT_PROJECT_SOURCES: Record<string, string[]> = {
  luxisoft: ["https://luxisoft.com/en/"]
};

// Keyword lists used by the conversation engine
export const SUPPORT_KEYWORDS = [
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

export const BUY_KEYWORDS = [
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

export const HUMAN_KEYWORDS = [
  "agente humano",
  "asesor humano",
  "humano",
  "ejecutivo",
  "representante",
  "persona real"
];

export const MEETING_KEYWORDS = [
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

export const GREETING_TOKENS = new Set([
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

export const STANDALONE_NAME_BLOCKED_TOKENS = new Set([
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

export const NEED_SIGNAL_REGEX =
  /(?:necesit|quier|quisier|busc|requier|cotiz|presupuesto|interesad[oa]|me interesa|me gustaria|deseo|pagina|sitio|tienda|ecommerce|app|aplicacion|automatiz|ia|inteligencia artificial|asistente virtual)/i;

export const SUPPORT_SIGNAL_REGEX =
  /(?:ayuda|soporte|problema|error|falla|incidencia|no\s+funcion|no\s+esta\s+funcionando|funcionando\s+mal|funciona\s+mal|respondiendo\s+mal|responde\s+mal)/i;

export const REPLY_STYLE_ROTATION = ["natural", "question"] as const;

export const LINK_REQUEST_KEYWORDS = [
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

export const LIST_REQUEST_KEYWORDS = [
  "lista",
  "opciones",
  "puntos",
  "enumerado",
  "resumen",
  "comparacion",
  "compara"
];

export const STEP_REQUEST_KEYWORDS = [
  "paso a paso",
  "pasos",
  "como empiezo",
  "proceso",
  "flujo",
  "implementacion"
];

export const REOPEN_AFTER_MEETING_KEYWORDS = [
  "nuevo proyecto",
  "nueva consulta",
  "otra consulta",
  "otra cotizacion",
  "nueva cotizacion",
  "empezar de nuevo",
  "reiniciar"
];

export const REOPEN_AFTER_SUPPORT_KEYWORDS = [
  "nuevo ticket",
  "nueva solicitud",
  "otra solicitud",
  "otro caso",
  "nuevo caso",
  "nuevo proyecto",
  "reiniciar"
];

export const POST_MEETING_COURTESY_KEYWORDS = [
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

export const PROJECT_FOLLOWUP_NUDGE_TOKENS = new Set([
  "si",
  "claro",
  "ok",
  "okay",
  "dale",
  "por",
  "favor",
  "porfa",
  "hazlo",
  "hagalo",
  "hazla",
  "registralo",
  "registrala",
  "registra",
  "registrar",
  "quiero",
  "queria",
  "necesito",
  "necesitamos",
  "respuesta",
  "respondan",
  "responder",
  "responda",
  "seguimiento",
  "equipo",
  "urgente",
  "urgentemente",
  "prioridad",
  "prioritario",
  "prioritaria",
  "solucion",
  "actualizacion",
  "actualicen",
  "novedad",
  "avisen",
  "avisenme",
  "avisarme",
  "contacten",
  "contactarme",
  "cuando",
  "va",
  "estar",
  "estara",
  "estaria",
  "listo",
  "lista",
  "mismo",
  "hoy",
  "ya",
  "apenas",
  "que",
  "me",
  "den",
  "dar",
  "con",
  "el",
  "la",
  "lo",
  "los",
  "las",
  "del",
  "de",
  "al",
  "mi",
  "tu",
  "su",
  "eso",
  "esto",
  "solo",
  "solamente",
  "mas",
  "ademas",
  "tambien",
  "una",
  "un",
  "no"
]);
