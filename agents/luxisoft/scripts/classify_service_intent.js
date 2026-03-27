const SERVICE_RULES = [
  {
    key: "website",
    label: "Pagina Web",
    keywords: ["pagina web", "sitio web", "web", "landing", "landing page"],
    brief_solution:
      "LUXISOFT puede crear una web a medida, optimizada y enfocada en tus objetivos de negocio."
  },
  {
    key: "ecommerce",
    label: "Tienda Virtual Ecommerce",
    keywords: ["ecommerce", "tienda virtual", "catalogo", "carrito", "pasarela", "pagos online"],
    brief_solution:
      "LUXISOFT puede desarrollar una tienda virtual con catalogo, pagos, pedidos y gestion comercial."
  },
  {
    key: "mobile_app",
    label: "App Movil",
    keywords: ["app", "aplicacion", "android", "ios", "play store", "app store"],
    brief_solution:
      "LUXISOFT puede desarrollar apps para Android e iOS y apoyar la publicacion en tiendas."
  },
  {
    key: "desktop_app",
    label: "App de Escritorio",
    keywords: ["escritorio", "desktop", "windows app", "software de escritorio"],
    brief_solution:
      "LUXISOFT puede desarrollar aplicaciones de escritorio adaptadas a tu operacion."
  },
  {
    key: "ai_automation",
    label: "IA y Automatizacion",
    keywords: ["ia", "inteligencia artificial", "automatizacion", "asistente", "bot", "whatsapp"],
    brief_solution:
      "LUXISOFT puede integrar asistentes virtuales, automatizaciones e IA adaptada a tu negocio."
  },
  {
    key: "web_optimization",
    label: "Optimizacion Web",
    keywords: ["optimizar", "velocidad", "seo", "conversion", "rendimiento"],
    brief_solution:
      "LUXISOFT puede mejorar velocidad, estructura, experiencia de usuario y conversion de tu web."
  }
];

function normalize(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .trim();
}

function buildInputText(input, context) {
  const direct = typeof input?.text === "string" ? input.text.trim() : "";
  if (direct) return direct;

  const current = String(context?.userMessage ?? "").trim();
  const recent = Array.isArray(context?.history)
    ? context.history
        .filter((item) => item?.role === "user")
        .slice(-4)
        .map((item) => String(item?.text ?? "").trim())
        .filter(Boolean)
    : [];

  return [current, ...recent].filter(Boolean).join("\n");
}

function scoreRule(text, rule) {
  const normalized = normalize(text);
  const matched = rule.keywords.filter((keyword) => normalized.includes(normalize(keyword)));
  return {
    matched,
    score: matched.length
  };
}

export default {
  name: "classify_service_intent",
  description:
    "Clasifica la necesidad del prospecto en un servicio de LUXISOFT y devuelve una explicacion breve sugerida.",
  parameters: {
    type: "object",
    properties: {
      text: {
        type: "string",
        description: "Texto opcional a clasificar. Si no se envia, usa el mensaje actual e historial reciente."
      }
    },
    additionalProperties: false
  },
  async run(input, context) {
    const text = buildInputText(input, context);
    if (!text) {
      return { ok: false, error: "text_required" };
    }

    const ranked = SERVICE_RULES.map((rule) => {
      const result = scoreRule(text, rule);
      return {
        key: rule.key,
        label: rule.label,
        brief_solution: rule.brief_solution,
        score: result.score,
        matched_keywords: result.matched
      };
    }).sort((a, b) => b.score - a.score);

    const top = ranked[0];
    if (!top || top.score <= 0) {
      return {
        ok: true,
        service_key: "unknown",
        service_label: "Sin clasificacion clara",
        confidence: 0,
        matched_keywords: [],
        brief_solution:
          "LUXISOFT puede evaluar tu necesidad y proponerte una solucion digital a medida.",
        next_step:
          "Pregunta que tipo de solucion necesita (web, ecommerce, app, IA/automatizacion u optimizacion) como primer paso de la recopilacion."
      };
    }

    const confidence = Math.min(0.98, 0.45 + top.score * 0.18);
    return {
      ok: true,
      service_key: top.key,
      service_label: top.label,
      confidence,
      matched_keywords: top.matched_keywords,
      brief_solution: top.brief_solution,
      next_step:
        "Explica brevemente la solucion y avanza directamente a pedir el nombre del prospecto como primer dato."
    };
  }
};
