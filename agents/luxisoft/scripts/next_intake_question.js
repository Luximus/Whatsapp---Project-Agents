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

function parseProfile(inputProfile) {
  const base =
    inputProfile && typeof inputProfile === "object" && !Array.isArray(inputProfile)
      ? inputProfile
      : {};

  const profile = {};
  for (const field of FIELD_ORDER) {
    profile[field] = compact(base[field]);
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
        description: "Perfil estructurado del prospecto (idealmente generado por extract_prospect_profile)."
      }
    },
    additionalProperties: false
  },
  async run(input) {
    const profile = parseProfile(input?.profile);
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
