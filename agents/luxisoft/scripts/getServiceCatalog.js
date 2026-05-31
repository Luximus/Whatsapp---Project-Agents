/**
 * Tool de ejemplo: devuelve el catálogo de servicios de LUXISOFT.
 *
 * Cada script de agente exporta por defecto un objeto { name, description,
 * parameters (JSON Schema), execute(args, context) -> string }.
 * El runtime lo carga por import() dinámico (sin eval).
 */
const CATALOG = {
  paneles: "LUXIPANEL: panel estilo cPanel para gestionar tus servidores.",
  licencias: "LP-LICENSE-SERVER: licencias, pagos y portal multi-tenant.",
  chat: "LuxiChat: backend de chat para tus aplicaciones.",
  voz: "NAVAI: framework de agentes de voz.",
  whatsapp: "WhatsApp Bridge: verificación OTP y asistentes por WhatsApp."
};

export default {
  name: "getServiceCatalog",
  description: "Lista los servicios de LUXISOFT. Úsala para responder qué ofrece la empresa.",
  parameters: {
    type: "object",
    properties: {
      area: {
        type: "string",
        description: "Filtro opcional por área (paneles, licencias, chat, voz, whatsapp)."
      }
    },
    additionalProperties: false
  },
  execute(args) {
    const area = typeof args?.area === "string" ? args.area.trim().toLowerCase() : "";
    if (area && CATALOG[area]) {
      return CATALOG[area];
    }
    return Object.entries(CATALOG)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
  }
};
