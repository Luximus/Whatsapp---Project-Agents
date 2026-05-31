/**
 * Tool: devuelve el perfil/cuenta del servicio vinculado (saldo, paneles, etc.).
 * Requiere que el número ya esté vinculado a ese servicio (ver linkAccount).
 */
export default {
  name: "getAccountInfo",
  description:
    "Devuelve la información de cuenta/perfil del servicio vinculado (p.ej. saldo y paneles en 'lp', paneles/servidores en 'luxipanel'). " +
    "Requiere vínculo previo. Servicios: lp | luxipanel | luxichat.",
  parameters: {
    type: "object",
    properties: {
      service: { type: "string", description: "Servicio vinculado: lp | luxipanel | luxichat." }
    },
    required: ["service"],
    additionalProperties: false
  },
  async execute(args, context) {
    const get = context?.actions?.getAccountInfo;
    if (typeof get !== "function") {
      return "error: servicios_no_disponibles";
    }
    const service = String(args?.service ?? "").trim();
    if (!service) return "error: falta_servicio";

    const res = await get({ service });
    switch (res?.status) {
      case "ok":
        return `ok: ${JSON.stringify(res.data)}`;
      case "auth_required":
        return "auth_required: por seguridad pídele el código 2FA actual de su app de autenticación y autentícalo con la tool authenticate; luego reintenta.";
      case "not_linked":
        return `error: cuenta_no_vinculada. Pídele vincular ${res.serviceName || service} con linkAccount({service:"${service}"}) primero.`;
      case "unknown_service":
        return "error: servicio_desconocido. Servicios válidos: lp, luxipanel, luxichat.";
      default:
        return `error: no_pude_consultar${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
