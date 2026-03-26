const FIELD_ORDER = [
  "name",
  "company",
  "project_type",
  "objective",
  "has_current_solution",
  "required_features",
  "budget_estimate",
  "expected_timeline",
  "email",
  "whatsapp_number",
  "meeting_availability"
];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function compact(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function buildCorpus(input, context) {
  const direct = typeof input?.text === "string" ? input.text.trim() : "";
  const current = String(context?.userMessage ?? "").trim();
  const historyText = Array.isArray(context?.history)
    ? context.history
        .filter((item) => item?.role === "user")
        .slice(-8)
        .map((item) => String(item?.text ?? "").trim())
        .filter(Boolean)
        .join("\n")
    : "";

  return [direct, current, historyText].filter(Boolean).join("\n");
}

function matchField(text, patterns) {
  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match?.[1]) return compact(match[1]);
  }
  return null;
}

function extractEmail(text) {
  const match = text.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function extractPhone(text, fallbackPhone) {
  const match = text.match(/(?:\+?\d[\d\s\-()]{7,}\d)/);
  if (match?.[0]) return compact(match[0]);
  return compact(fallbackPhone);
}

function extractProjectType(text) {
  const normalized = normalize(text);
  if (/(tienda virtual|ecommerce|catalogo|carrito)/.test(normalized)) return "Ecommerce";
  if (/(pagina web|sitio web|landing)/.test(normalized)) return "Pagina web";
  if (/(app|aplicacion|android|ios)/.test(normalized)) return "Aplicacion";
  if (/(ia|inteligencia artificial|automatizacion|bot|asistente)/.test(normalized)) {
    return "IA / Automatizacion";
  }
  if (/(optimizacion|seo|velocidad|conversion)/.test(normalized)) return "Optimizacion web";
  return null;
}

function extractProfile(text, context) {
  const profile = {
    name: matchField(text, [
      /(?:mi nombre es|me llamo|soy)\s+([^\n,.!?:;]+)/i,
      /(?:nombre)\s*[:\-]\s*([^\n,.!?:;]+)/i
    ]),
    company: matchField(text, [
      /(?:empresa|emprendimiento|negocio|compania|compa\u00f1ia)\s*[:\-]?\s*([^\n,.!?:;]+)/i,
      /(?:trabajo en|represento a)\s+([^\n,.!?:;]+)/i
    ]),
    project_type: extractProjectType(text),
    objective: matchField(text, [
      /(?:objetivo|meta|quiero|necesito|busco)\s*[:\-]?\s*([^\n.!?]+)/i
    ]),
    has_current_solution: matchField(text, [
      /(?:ya tengo|actualmente tengo|cuento con)\s+([^\n.!?]+)/i,
      /(?:tengo sitio|tengo web|tengo app|tengo tienda)\s*[:\-]?\s*([^\n.!?]+)/i
    ]),
    required_features: matchField(text, [
      /(?:funcionalidades|funciones|requisitos|necesito que tenga)\s*[:\-]?\s*([^\n.!?]+)/i
    ]),
    budget_estimate: matchField(text, [
      /(?:presupuesto|budget|inversion|inversion estimada)\s*[:\-]?\s*([^\n.!?]+)/i
    ]),
    expected_timeline: matchField(text, [
      /(?:tiempo|fecha|plazo|entrega|cuando)\s*[:\-]?\s*([^\n.!?]+)/i
    ]),
    email: extractEmail(text),
    whatsapp_number: extractPhone(text, context?.phoneE164),
    meeting_availability: matchField(text, [
      /(?:disponibilidad|disponible|horario|reunion|agenda|cita)\s*[:\-]?\s*([^\n.!?]+)/i
    ])
  };

  return profile;
}

export default {
  name: "extract_prospect_profile",
  description:
    "Extrae y estructura datos comerciales del prospecto desde mensaje e historial para calificacion y seguimiento.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Texto opcional para extraer datos. Si no se envia, usa mensaje actual e historial de usuario."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    const corpus = buildCorpus(input, context);
    if (!corpus.trim()) {
      return { ok: false, error: "text_required" };
    }

    const profile = extractProfile(corpus, context);
    const missing_fields = FIELD_ORDER.filter((field) => !compact(profile[field]));
    const collected_fields = FIELD_ORDER.filter((field) => compact(profile[field]));
    const completion_ratio = Number((collected_fields.length / FIELD_ORDER.length).toFixed(2));

    return {
      ok: true,
      profile,
      collected_fields,
      missing_fields,
      completion_ratio
    };
  }
};
