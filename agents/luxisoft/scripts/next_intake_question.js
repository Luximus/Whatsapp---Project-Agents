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

const FIELD_QUESTIONS = {
  name: "Para continuar, me compartes tu nombre por favor?",
  company: "Cual es el nombre de tu empresa o emprendimiento?",
  project_type: "Que tipo de proyecto necesitas (web, ecommerce, app, IA o optimizacion)?",
  objective: "Cual es el objetivo principal que quieres lograr con este proyecto?",
  has_current_solution: "Ya cuentas con sitio web, app o tienda actual?",
  required_features: "Que funcionalidades clave necesitas en esta primera fase?",
  budget_estimate: "Tienes un presupuesto estimado para el proyecto?",
  expected_timeline: "En que tiempo estimado te gustaria tener una primera entrega?",
  email: "Cual es tu correo electronico de contacto?",
  whatsapp_number: "Este mismo numero de WhatsApp es el mejor para contactarte?",
  meeting_availability: "Que disponibilidad tienes para agendar una reunion?"
};

function compact(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function extractEmailFromText(text) {
  const match = String(text ?? "").match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i);
  return match?.[0]?.toLowerCase() ?? null;
}

function inferFieldFromAssistant(assistantText) {
  if (!assistantText) return null;
  const t = normalize(assistantText);
  if (/(me compartes tu nombre|indicame tus nombres|nombre por favor|tus nombres|tu nombre)/i.test(t)) return "name";
  if (/(tus apellidos|indicame tus apellidos)/.test(t)) return "_lastName";
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

function buildProfileFromContext(context) {
  const profile = {};
  for (const field of FIELD_ORDER) {
    profile[field] = null;
  }

  const history = Array.isArray(context?.history) ? context.history : [];
  const currentMessage = compact(context?.userMessage);

  // Walk assistant→user pairs to fill fields from Q&A history
  let lastName = null;
  for (let i = 0; i < history.length - 1; i++) {
    const item = history[i];
    if (item?.role !== "assistant") continue;
    const next = history[i + 1];
    if (!next || next.role !== "user") continue;
    const userText = compact(next.text);
    if (!userText || userText.length > 200) continue;

    const field = inferFieldFromAssistant(item.text);
    if (!field) continue;

    if (field === "name" && !profile.name) {
      profile.name = userText;
    } else if (field === "_lastName" && !lastName) {
      lastName = userText;
    } else if (field === "company" && !profile.company && !userText.includes("@")) {
      profile.company = userText;
    } else if (field === "email" && !profile.email) {
      const email = extractEmailFromText(userText);
      if (email) profile.email = email;
    } else if (field === "objective" && !profile.objective) {
      profile.objective = userText;
    } else if (field === "project_type" && !profile.project_type) {
      profile.project_type = userText;
    } else if (field === "has_current_solution" && !profile.has_current_solution) {
      profile.has_current_solution = userText;
    } else if (field === "required_features" && !profile.required_features) {
      profile.required_features = userText;
    } else if (field === "budget_estimate" && !profile.budget_estimate) {
      profile.budget_estimate = userText;
    } else if (field === "expected_timeline" && !profile.expected_timeline) {
      profile.expected_timeline = userText;
    } else if (field === "meeting_availability" && !profile.meeting_availability) {
      profile.meeting_availability = userText;
    } else if (field === "whatsapp_number" && !profile.whatsapp_number) {
      profile.whatsapp_number = userText;
    }
  }

  // Append lastName to name if available
  if (profile.name && lastName && !profile.name.toLowerCase().includes(lastName.toLowerCase())) {
    profile.name = `${profile.name} ${lastName}`;
  }

  // Scan all user messages for email if not yet found
  if (!profile.email) {
    const allUserText = [
      ...history.filter(h => h?.role === "user").map(h => h.text ?? ""),
      currentMessage ?? ""
    ].join(" ");
    const email = extractEmailFromText(allUserText);
    if (email) profile.email = email;
  }

  return profile;
}

function parseProfile(inputProfile, context) {
  const base =
    inputProfile && typeof inputProfile === "object" && !Array.isArray(inputProfile)
      ? inputProfile
      : null;

  // If no profile provided, build from context history
  if (!base) {
    return buildProfileFromContext(context);
  }

  const profile = {};
  for (const field of FIELD_ORDER) {
    profile[field] = compact(base[field]);
  }

  // Accept firstName/lastName from lead_profile format as fallback for name
  if (!profile["name"]) {
    const firstName = compact(base["firstName"]);
    const lastName = compact(base["lastName"]);
    if (firstName) {
      profile["name"] = lastName ? `${firstName} ${lastName}` : firstName;
    }
  }

  // Accept need from lead_profile format as fallback for objective
  if (!profile["objective"]) {
    const need = compact(base["need"]);
    if (need) profile["objective"] = need;
  }

  // For fields still missing, try to recover from conversation history
  // This ensures previously answered sales fields (project_type, has_current_solution, etc.)
  // are not re-asked when the explicit lead_profile only contains contact fields
  const missingFields = FIELD_ORDER.filter((f) => !profile[f]);
  if (missingFields.length > 0 && context) {
    const fromHistory = buildProfileFromContext(context);
    for (const field of missingFields) {
      if (fromHistory[field]) profile[field] = fromHistory[field];
    }
  }

  return profile;
}

function inferStage(missing) {
  if (!missing.length) return "ready_for_meeting";
  if (missing.length >= FIELD_ORDER.length - 2) return "discovery";
  if (missing.includes("email") || missing.includes("meeting_availability")) return "closing";
  return "qualification";
}

export default {
  name: "next_intake_question",
  description:
    "Define el siguiente paso de levantamiento comercial y sugiere la proxima pregunta concreta segun campos faltantes.",
  parameters: {
    type: "object",
    properties: {
      profile: {
        type: "object",
        description: "Perfil estructurado del prospecto (idealmente generado por extract_prospect_profile). Si no se provee, se construye automaticamente desde el historial."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    const profile = parseProfile(input?.profile, context);
    const missing_fields = FIELD_ORDER.filter((field) => !profile[field]);
    const next_field = missing_fields[0] ?? null;
    const stage = inferStage(missing_fields);

    return {
      ok: true,
      stage,
      next_field,
      next_question: next_field ? FIELD_QUESTIONS[next_field] : null,
      missing_fields,
      ready_for_meeting: missing_fields.length === 0,
      recommended_closing:
        missing_fields.length === 0
          ? "Perfecto. Con esta informacion ya podemos proponerte agendar una reunion."
          : "Continua con una sola pregunta puntual para completar el perfil sin abrumar."
    };
  }
};
