/**
 * Tool: transfiere la conversación a un agente humano.
 *
 * Notifica al equipo por CORREO (no por WhatsApp). La lógica de envío se inyecta
 * vía `context.actions` desde la capa de rutas (webhook).
 */
export default {
  name: "escalateToHuman",
  description:
    "Transfiere la conversación a un agente humano del equipo de LUXISOFT cuando no puedes resolver " +
    "algo por chat (requiere acceso a la cuenta, datos privados, un caso técnico o el cliente lo pide). " +
    "Resume el caso de forma clara. El equipo recibe la notificación por correo y dará seguimiento.",
  parameters: {
    type: "object",
    properties: {
      summary: {
        type: "string",
        description: "Resumen claro del caso y de lo que necesita la persona."
      },
      topic: { type: "string", description: "Tema o categoría (soporte, ventas, facturación...)." },
      contactName: { type: "string", description: "Nombre de la persona, si lo tienes." },
      company: { type: "string", description: "Empresa, si la menciona." },
      contactEmail: { type: "string", description: "Correo del contacto, si lo compartió." }
    },
    required: ["summary"],
    additionalProperties: false
  },
  async execute(args, context) {
    const escalate = context?.actions?.escalateToHuman;
    if (typeof escalate !== "function") {
      return "error: transferencia_no_disponible";
    }

    const summary = String(args?.summary ?? "").trim();
    if (!summary) {
      return "error: falta_resumen_del_caso";
    }

    const clean = (value) => String(value ?? "").trim();
    const result = await escalate({
      summary,
      topic: clean(args?.topic) || "transferencia a humano",
      contactName: clean(args?.contactName),
      company: clean(args?.company),
      contactEmail: clean(args?.contactEmail)
    });

    if (result?.ok) {
      return "ok: caso enviado al equipo humano por correo. Confirma a la persona que un agente la contactará pronto.";
    }
    return `error: no_se_pudo_transferir${result?.message ? `: ${result.message}` : ""}`;
  }
};
