/**
 * Tool: cierra la sesión activa con el servidor (deja de operar y de consumir
 * MB). El vínculo de la cuenta se mantiene; solo se cierra la conexión.
 */
export default {
  name: "disconnectServer",
  description:
    "Cierra la sesión activa con el servidor LUXIPANEL (deja de operar y de consumir MB). No desvincula la cuenta.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, context) {
    const disconnect = context?.actions?.disconnectServer;
    if (typeof disconnect !== "function") return "error: servicios_no_disponibles";
    const res = await disconnect();
    switch (res?.status) {
      case "disconnected":
        return "ok: cerré la conexión con el servidor. El consumo de MB se detiene.";
      case "no_session":
        return "info: no había ningún servidor conectado.";
      default:
        return "error: no_pude_desconectar";
    }
  }
};
