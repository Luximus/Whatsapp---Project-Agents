/**
 * Tool: cambia el servidor activo de la sesión (cierra el actual y conecta al
 * nuevo target). Útil cuando el cliente tiene varios servidores.
 */
export default {
  name: "switchConnection",
  description:
    "Cambia el servidor activo del asistente a otro target del cliente. Usa listServers para ver los IDs. Requiere vínculo de luxipanel.",
  parameters: {
    type: "object",
    properties: {
      targetId: { type: "string", description: "ID del servidor al que cambiar (de listServers)." }
    },
    required: ["targetId"],
    additionalProperties: false
  },
  async execute(args, context) {
    const sw = context?.actions?.switchConnection;
    if (typeof sw !== "function") return "error: servicios_no_disponibles";
    const targetId = String(args?.targetId ?? "").trim();
    if (!targetId) return "error: falta_target";
    const res = await sw({ targetId });
    switch (res?.status) {
      case "connected":
        return `ok: ahora estás conectado al servidor ${res.serverName}.`;
      case "auth_required":
        return "auth_required: pídele el código 2FA de su app y usa authenticate; luego reintenta.";
      case "not_linked":
        return "error: cuenta_no_vinculada. Vincula luxipanel con linkAccount primero.";
      default:
        return `error: no_pude_cambiar${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
