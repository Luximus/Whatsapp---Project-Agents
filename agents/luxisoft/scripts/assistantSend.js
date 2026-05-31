/**
 * Tool: envía una instrucción al asistente IA del servidor conectado (crear,
 * editar, consultar, ejecutar...). Espera el resultado; si tarda mucho, usa
 * assistantPoll para seguir leyéndolo. Requiere connectServer antes.
 *
 * Lo que el asistente del panel puede hacer depende del rol del usuario en su
 * panel (acciones de escritura/CLI requieren permisos de admin allí).
 */
export default {
  name: "assistantSend",
  description:
    "Envía una instrucción al asistente IA del servidor LUXIPANEL conectado (crear/editar/consultar/ejecutar) y devuelve su respuesta. " +
    "Requiere connectServer antes. Consume saldo de datos (MB) del cliente.",
  parameters: {
    type: "object",
    properties: {
      text: { type: "string", description: "Instrucción o pregunta para el asistente del servidor." }
    },
    required: ["text"],
    additionalProperties: false
  },
  async execute(args, context) {
    const send = context?.actions?.assistantSend;
    if (typeof send !== "function") return "error: servicios_no_disponibles";
    const text = String(args?.text ?? "").trim();
    if (!text) return "error: falta_instruccion";

    const res = await send({ text });
    switch (res?.status) {
      case "answer":
        return res.text && res.text.trim()
          ? `ok: ${res.text}`
          : "ok: el asistente completó la tarea sin texto de respuesta.";
      case "working":
        return "working: el asistente sigue trabajando. Dile a la persona que en un momento le traes el resultado y usa assistantPoll.";
      case "auth_required":
        return "auth_required: pídele el código 2FA de su app y usa authenticate; luego reintenta.";
      case "no_session":
        return "error: sin_servidor_conectado. Usa connectServer primero.";
      case "forbidden":
        return "error: sin_permiso. El usuario no tiene permisos para esa acción en su panel (acciones avanzadas requieren rol de administrador).";
      default:
        return `error: fallo_del_asistente${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
