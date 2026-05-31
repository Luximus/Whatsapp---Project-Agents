/**
 * Tool: continúa leyendo el resultado del último mensaje enviado al asistente
 * del servidor (para respuestas largas o que tardan). Requiere una sesión activa.
 */
export default {
  name: "assistantPoll",
  description:
    "Continúa leyendo el resultado del asistente del servidor cuando assistantSend devolvió 'working'. Requiere un servidor conectado.",
  parameters: { type: "object", properties: {}, additionalProperties: false },
  async execute(_args, context) {
    const poll = context?.actions?.assistantPoll;
    if (typeof poll !== "function") return "error: servicios_no_disponibles";
    const res = await poll();
    switch (res?.status) {
      case "answer":
        return res.text && res.text.trim()
          ? `ok: ${res.text}`
          : "ok: el asistente terminó (sin texto adicional).";
      case "working":
        return "working: aún en proceso. Espera un momento y vuelve a usar assistantPoll.";
      case "auth_required":
        return "auth_required: pídele el código 2FA de su app y usa authenticate; luego reintenta.";
      case "no_session":
        return "error: sin_servidor_conectado. Usa connectServer primero.";
      default:
        return `error: fallo_al_consultar${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
