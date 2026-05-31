/**
 * Tool: devuelve el catálogo de productos de LUXISOFT para que el asistente
 * describa cada uno con datos exactos en lugar de improvisar.
 *
 * Cada script de agente exporta por defecto un objeto { name, description,
 * parameters (JSON Schema), execute(args, context) -> string }.
 * El runtime lo carga por import() dinámico (sin eval).
 */
const CATALOG = {
  web: "luxisoft.com: sitio y plataforma de LUXISOFT, punto de entrada a los productos, a la cuenta de cliente y al soporte.",
  luxipanel:
    "LUXIPANEL: panel de administración de servidores estilo cPanel (archivos, terminal web, DNS, SSL/TLS, correo, firewall, backups, cron, monitoreo y antivirus) con asistente de IA integrado. Se usa desde el navegador.",
  licencias:
    "LP-LICENSE-SERVER (LP-LS): licencias y pagos, portal de cliente, gestión de dominios y certificados SSL, y acceso seguro a servidores. Respalda a LUXIPANEL en modo gestionado.",
  voz: "NAVAI: framework de agentes de voz en tiempo real para asistentes, encuestas y evaluaciones, integrable con otros canales como WhatsApp.",
  chat: "LuxiChat: backend de chat para tus aplicaciones.",
  whatsapp: "WhatsApp Bridge: verificación OTP y asistentes por WhatsApp."
};

// Sinónimos comunes → clave del catálogo, para que el filtro sea tolerante.
const ALIASES = {
  luxisoft: "web",
  "luxisoft.com": "web",
  sitio: "web",
  website: "web",
  panel: "luxipanel",
  paneles: "luxipanel",
  cpanel: "luxipanel",
  "lp-ls": "licencias",
  "lp-license-server": "licencias",
  lp: "licencias",
  licencia: "licencias",
  license: "licencias",
  licenses: "licencias",
  pagos: "licencias",
  navai: "voz",
  voice: "voz",
  luxichat: "chat",
  otp: "whatsapp",
  bridge: "whatsapp"
};

export default {
  name: "getServiceCatalog",
  description:
    "Lista los productos de LUXISOFT (web, LUXIPANEL, LP-LS, NAVAI, LuxiChat, WhatsApp Bridge). Úsala para describir qué ofrece la empresa o dar soporte de un producto.",
  parameters: {
    type: "object",
    properties: {
      area: {
        type: "string",
        description:
          "Filtro opcional por producto (web, luxipanel, licencias, voz, chat, whatsapp). Acepta sinónimos como navai, lp-ls o luxisoft."
      }
    },
    additionalProperties: false
  },
  execute(args) {
    const raw = typeof args?.area === "string" ? args.area.trim().toLowerCase() : "";
    const area = ALIASES[raw] ?? raw;
    if (area && CATALOG[area]) {
      return CATALOG[area];
    }
    return Object.entries(CATALOG)
      .map(([key, value]) => `- ${key}: ${value}`)
      .join("\n");
  }
};
