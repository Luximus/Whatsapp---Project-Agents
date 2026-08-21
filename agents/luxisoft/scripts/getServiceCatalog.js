const API = String(process.env.LUXISOFT_PLATFORM_API_URL || "http://127.0.0.1:3200/api/v1").replace(/\/+$/, "");

const FALLBACK = {
  positioning: "LuxiSoft permite crear o modificar un sitio o tienda con IA, publicarlo, vender y administrarlo desde una sola plataforma.",
  features: ["sitio asistido por IA", "catálogo", "pagos en línea según plan", "WhatsApp con IA", "dominio propio según plan", "panel y estadísticas"],
  plans: ["Free", "Plus", "Premium"]
};

const money = (cents) => new Intl.NumberFormat("es-CO", { style: "currency", currency: "COP", maximumFractionDigits: 0 }).format(Number(cents || 0) / 100);

async function json(path) {
  const response = await fetch(`${API}${path}`, { headers: { accept: "application/json" }, signal: globalThis.AbortSignal.timeout(5000) });
  if (!response.ok) throw new Error(`luxisoft_catalog_http_${response.status}`);
  return response.json();
}

export default {
  name: "getServiceCatalog",
  description: "Consulta la oferta VIGENTE de LuxiSoft: planes y precios actuales, motores de negocio habilitados y funciones. Úsala antes de recomendar o cotizar; nunca memorices precios.",
  parameters: {
    type: "object",
    properties: {
      area: { type: "string", enum: ["overview", "plans", "engines", "demos"], description: "Información que necesita la persona." },
      planCode: { type: "string", enum: ["free", "plus", "premium"], description: "Plan específico si preguntó por uno." }
    },
    additionalProperties: false
  },
  async execute(args, context) {
    const area = String(args?.area || "overview");
    if (["voz", "navai"].includes(area.toLowerCase())) return "NAVAI: proyecto de agentes de voz en tiempo real de Luxisoft para asistentes, encuestas y evaluaciones.";
    try {
      if (area === "plans") {
        const payload = await json("/billing/plans");
        const plans = Array.isArray(payload?.plans) ? payload.plans : [];
        const filtered = args?.planCode ? plans.filter((plan) => plan.code === args.planCode) : plans;
        const lines = filtered.map((plan) => {
          const periods = (plan.periods || []).map((period) => `${period.code}: ${money(period.priceCopCents)}${period.installments > 1 ? ` × ${period.installments} cuotas` : " pago único"}`).join("; ");
          return `${String(plan.code).toUpperCase()}: ${plan.maxProducts == null ? "productos ilimitados" : `${plan.maxProducts} productos`}, ${plan.aiReplies} respuestas IA/mes, ${plan.siteChanges} cambios IA/mes${periods ? `. ${periods}` : ". Sin costo"}`;
        });
        context?.render?.([{ kind: "buttons", body: "¿Qué quieres hacer ahora?", options: [
          { id: "START_TRIAL", title: "Probar 7 días" },
          { id: "REQUEST_QUOTE", title: "Solicitar asesoría" },
          { id: "VIEW_DEMOS", title: "Ver ejemplos" }
        ] }]);
        return lines.join("\n");
      }
      if (area === "engines") {
        const payload = await json("/templates");
        const templates = Array.isArray(payload?.data) ? payload.data : [];
        const enabled = templates.filter((row) => row.enabled !== false);
        const coming = templates.filter((row) => row.enabled === false);
        context?.render?.([{ kind: "list", body: "Elige el tipo de proyecto que más se parece a tu negocio.", buttonLabel: "Ver opciones", sections: [{ title: "Disponibles", rows: enabled.slice(0, 10).map((row) => ({ id: `ENGINE:${row.key}`, title: row.name, description: row.description })) }] }]);
        return `Disponibles hoy:\n${enabled.map((row) => `- ${row.name}: ${row.description}. ${Array.isArray(row.features) ? row.features.join(", ") : ""}`).join("\n")}\n\nPróximamente (no ofrecer como activos):\n${coming.map((row) => `- ${row.name}`).join("\n")}`;
      }
      if (area === "demos") {
        context?.render?.([{ kind: "link", body: "Explora ejemplos reales creados con LuxiSoft.", label: "Ver proyectos", url: "https://luxisoft.com/es#proyectos" }]);
        return "Ejemplos publicados: Eje Veleño, VitaSana, UFIT Mercado Saludable, LuxiGames, LUXIPANEL y NAVAI. Usa el enlace oficial para ver la selección vigente.";
      }
      context?.render?.([{ kind: "buttons", body: "Puedo orientarte según tu objetivo.", options: [
        { id: "CATALOG:ENGINES", title: "Crear mi sitio" },
        { id: "CATALOG:PLANS", title: "Planes y precios" },
        { id: "HUMAN_HELP", title: "Hablar con alguien" }
      ] }]);
      return `${FALLBACK.positioning}\nIncluye: ${FALLBACK.features.join(", ")}. Planes: ${FALLBACK.plans.join(", ")}. La prueba completa dura 7 días y no requiere tarjeta.`;
    } catch {
      return `${FALLBACK.positioning} Incluye ${FALLBACK.features.join(", ")}. No pude consultar el catálogo en vivo; no des precios y ofrece reintentar o transferir a una persona.`;
    }
  }
};
