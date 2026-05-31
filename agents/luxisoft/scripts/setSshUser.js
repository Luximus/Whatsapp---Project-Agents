/**
 * Tool: activa o desactiva (soft-disable) un usuario/acceso SSH del cliente.
 * Un acceso desactivado no puede usarse para conectar (no se borra). Usa
 * listServers para obtener el id del usuario SSH. NO permite crear ni eliminar.
 */
export default {
  name: "setSshUser",
  description:
    "Activa o desactiva un usuario/acceso SSH del cliente (soft-disable; no borra). " +
    "Obtén el id con listServers. Requiere vínculo de luxipanel y sesión 2FA.",
  parameters: {
    type: "object",
    properties: {
      targetId: { type: "string", description: "ID del usuario/acceso SSH (de listServers)." },
      enabled: { type: "boolean", description: "true = activar, false = desactivar." }
    },
    required: ["targetId", "enabled"],
    additionalProperties: false
  },
  async execute(args, context) {
    const setEnabled = context?.actions?.setSshEnabled;
    if (typeof setEnabled !== "function") return "error: servicios_no_disponibles";
    const targetId = String(args?.targetId ?? "").trim();
    if (!targetId) return "error: falta_target";
    if (typeof args?.enabled !== "boolean") return "error: falta_enabled";

    const res = await setEnabled({ targetId, enabled: args.enabled });
    switch (res?.status) {
      case "ok":
        return `ok: el usuario SSH "${res.name}" quedó ${res.enabled ? "ACTIVADO" : "DESACTIVADO"}.`;
      case "auth_required":
        return "auth_required: pídele el código 2FA de su app y usa authenticate; luego reintenta.";
      case "not_linked":
        return "error: cuenta_no_vinculada. Vincula luxipanel con linkAccount primero.";
      case "not_found":
        return "error: usuario_ssh_no_encontrado. Verifica el id con listServers.";
      default:
        return `error: no_pude_cambiar_estado${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
