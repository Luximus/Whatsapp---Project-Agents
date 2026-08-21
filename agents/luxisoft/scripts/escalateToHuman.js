/**
 * Tool: transfiere la conversación a un agente humano.
 *
 * Pausa la IA, envía el chat a la bandeja humana y notifica por correo.
 */
export default {
  name: "escalateToHuman",
  description:
    "Transfiere la conversación a un agente humano del equipo de LUXISOFT cuando no puedes resolver " +
    "algo por chat (requiere acceso a la cuenta, datos privados, un caso técnico o el cliente lo pide). " +
    "Resume el caso de forma clara. La IA dejará de responder hasta que el agente humano cierre la conversación.",
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
      return "ok: conversación enviada a la bandeja humana y agente IA pausado. Confirma que una persona del equipo continuará por este mismo chat.";
    }
    return `error: no_se_pudo_transferir${result?.message ? `: ${result.message}` : ""}`;
  }
};
