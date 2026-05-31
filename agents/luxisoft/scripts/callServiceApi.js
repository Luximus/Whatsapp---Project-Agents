/**
 * Tool: acceso genérico (acotado) a la API del servicio vinculado. Cada servicio
 * expone un conjunto de acciones permitidas (allowlist en su connector); por eso
 * `action` es libre pero el servicio rechaza lo no soportado.
 *
 * Ejemplos de acciones: lp → summary | balance | panels; luxipanel → panels | servers.
 */
export default {
  name: "callServiceApi",
  description:
    "Ejecuta una acción de la API del servicio vinculado. Úsala para datos puntuales de la cuenta. " +
    "Servicios: lp | luxipanel | luxichat. Acciones típicas: lp(summary|balance|panels), luxipanel(panels|servers). Requiere vínculo previo.",
  parameters: {
    type: "object",
    properties: {
      service: { type: "string", description: "Servicio vinculado: lp | luxipanel | luxichat." },
      action: { type: "string", description: "Acción a ejecutar (p.ej. balance, panels)." },
      params: {
        type: "object",
        description: "Parámetros opcionales de la acción.",
        additionalProperties: true
      }
    },
    required: ["service", "action"],
    additionalProperties: false
  },
  async execute(args, context) {
    const call = context?.actions?.callServiceApi;
    if (typeof call !== "function") {
      return "error: servicios_no_disponibles";
    }
    const service = String(args?.service ?? "").trim();
    const action = String(args?.action ?? "").trim();
    if (!service) return "error: falta_servicio";
    if (!action) return "error: falta_accion";

    const params =
      args?.params && typeof args.params === "object" && !Array.isArray(args.params)
        ? args.params
        : undefined;

    const res = await call({ service, action, params });
    switch (res?.status) {
      case "ok":
        return `ok: ${JSON.stringify(res.data)}`;
      case "auth_required":
        return "auth_required: pídele el código 2FA de su app y usa authenticate; luego reintenta.";
      case "not_linked":
        return `error: cuenta_no_vinculada. Vincula ${res.serviceName || service} con linkAccount primero.`;
      case "unknown_service":
        return "error: servicio_desconocido. Servicios válidos: lp, luxipanel, luxichat.";
      default:
        return `error: accion_fallida${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
