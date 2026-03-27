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

function inferLastAskedField(assistantText) {
  if (!assistantText) return null;
  const t = String(assistantText).toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
  if (/(me compartes tu nombre|indicame tus nombres|nombre por favor|tus nombres)/i.test(t)) return "name";
  if (/(tus apellidos|indicame tus apellidos)/.test(t)) return "last_name";
  if (/(empresa|emprendimiento|negocio)/.test(t) && !/(correo|email)/.test(t) && !/(nombre)/.test(t)) return "company";
  if (/(correo|email)/.test(t)) return "email";
  if (/(objetivo|quieres lograr|lograr con este proyecto)/.test(t)) return "objective";
  if (/(tipo de proyecto|que tipo de proyecto|web.*ecommerce.*app|solucion necesitas)/.test(t)) return "project_type";
  if (/(ya cuentas con|sitio web.*actual|app.*actual|tienda.*actual)/.test(t)) return "has_current_solution";
  if (/(funcionalidades|funciones clave|primera fase)/.test(t)) return "required_features";
  if (/(presupuesto|budget|inversion estimada)/.test(t)) return "budget_estimate";
  if (/(tiempo estimado|primera entrega|plazo)/.test(t)) return "expected_timeline";
  if (/(disponibilidad|que dia.*reuni|horario.*reuni)/.test(t)) return "meeting_availability";
  if (/(mismo numero.*contactarte|mejor.*contactarte|numero.*whatsapp)/.test(t)) return "whatsapp_number";
  return null;
}

function applyContextAwareFillIn(profile, currentUserMessage, lastAssistantText) {
  if (!currentUserMessage || !lastAssistantText) return profile;
  const candidate = compact(currentUserMessage);
  if (!candidate || candidate.length > 180) return profile;
  if (candidate.split(" ").length > 14 || candidate.includes("?")) return profile;

  const inferredField = inferLastAskedField(lastAssistantText);
  if (!inferredField) return profile;

  const result = { ...profile };

  if (inferredField === "name" && !result.name) {
    result.name = candidate;
  } else if (inferredField === "last_name") {
    if (result.name && !result.name.toLowerCase().includes(candidate.toLowerCase())) {
      result.name = `${result.name} ${candidate}`;
    } else if (!result.name) {
      result.name = candidate;
    }
  } else if (inferredField === "company" && !result.company && !candidate.includes("@")) {
    result.company = candidate;
  } else if (inferredField === "email" && !result.email && candidate.includes("@")) {
    result.email = candidate.toLowerCase();
  } else if (inferredField === "objective" && !result.objective) {
    result.objective = candidate;
  } else if (inferredField === "project_type" && !result.project_type) {
    result.project_type = extractProjectType(candidate) ?? candidate;
  } else if (inferredField === "has_current_solution" && !result.has_current_solution) {
    result.has_current_solution = candidate;
  } else if (inferredField === "required_features" && !result.required_features) {
    result.required_features = candidate;
  } else if (inferredField === "budget_estimate" && !result.budget_estimate) {
    result.budget_estimate = candidate;
  } else if (inferredField === "expected_timeline" && !result.expected_timeline) {
    result.expected_timeline = candidate;
  } else if (inferredField === "meeting_availability" && !result.meeting_availability) {
    result.meeting_availability = candidate;
  } else if (inferredField === "whatsapp_number" && !result.whatsapp_number) {
    result.whatsapp_number = candidate;
  }

  return result;
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

    let profile = extractProfile(corpus, context);

    // Apply context-aware fill through all assistant→user pairs in history
    // so fields set in early turns (e.g. name at T1) are not lost when tool is called later.
    if (Array.isArray(context?.history)) {
      for (let i = 0; i < context.history.length - 1; i++) {
        const item = context.history[i];
        if (item?.role !== "assistant") continue;
        const nextItem = context.history[i + 1];
        if (!nextItem || nextItem.role !== "user") continue;
        profile = applyContextAwareFillIn(profile, nextItem.text, item.text);
      }
    }

    // Also apply for current turn
    const lastAssistant = Array.isArray(context?.history)
      ? (context.history.filter((h) => h.role === "assistant").slice(-1)[0]?.text ?? "")
      : "";
    const currentUserMessage = context?.userMessage ?? "";
    profile = applyContextAwareFillIn(profile, currentUserMessage, lastAssistant);

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
