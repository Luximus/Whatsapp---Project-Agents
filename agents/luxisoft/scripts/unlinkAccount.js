/**
 * Tool: desvincula la cuenta de un servicio de este número (y cierra cualquier
 * sesión a servidor abierta). Úsala si la persona pide "desvincular" o dejar de
 * tener acceso a su cuenta desde WhatsApp.
 */
export default {
  name: "unlinkAccount",
  description:
    "Desvincula la cuenta de un servicio de este número de WhatsApp (lp | luxipanel | luxichat). Cierra también la sesión a servidor si la hay.",
  parameters: {
    type: "object",
    properties: {
      service: { type: "string", description: "Servicio a desvincular: lp | luxipanel | luxichat." }
    },
    required: ["service"],
    additionalProperties: false
  },
  async execute(args, context) {
    const unlink = context?.actions?.unlinkAccount;
    if (typeof unlink !== "function") return "error: servicios_no_disponibles";
    const service = String(args?.service ?? "").trim();
    if (!service) return "error: falta_servicio";
    const res = await unlink({ service });
    const name = res?.serviceName || service;
    switch (res?.status) {
      case "unlinked":
        return `ok: desvinculé la cuenta de ${name} de este número.`;
      case "not_linked":
        return `info: ${name} no estaba vinculada a este número.`;
      case "unknown_service":
        return "error: servicio_desconocido. Servicios válidos: lp, luxipanel, luxichat.";
      default:
        return "error: no_pude_desvincular";
    }
  }
};
