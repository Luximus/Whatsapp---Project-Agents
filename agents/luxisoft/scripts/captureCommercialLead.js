/** Registra en CRM una intención comercial explícita y útil. */
export default {
  name: "captureCommercialLead",
  description:
    "Registra una oportunidad comercial solo cuando la persona muestra una señal real: pide cotización, " +
    "precio para su caso, demostración, propuesta, fecha de inicio o confirma intención de contratar. " +
    "No la uses por un saludo, curiosidad general ni una consulta de soporte.",
  parameters: {
    type: "object",
    properties: {
      reason: { type: "string", description: "Señal comercial concreta expresada por la persona." },
      service: { type: "string", description: "Servicio de interés, si puede identificarse." }
    },
    required: ["reason"],
    additionalProperties: false
  },
  async execute(args, context) {
    const capture = context?.actions?.captureCommercialLead;
    if (typeof capture !== "function") return "error: crm_no_disponible";
    const reason = String(args?.reason ?? "").trim();
    if (!reason) return "error: falta_senal_comercial";
    const result = await capture({ reason, service: String(args?.service ?? "").trim() });
    return result?.ok ? "ok: oportunidad registrada en CRM" : "error: no_se_pudo_registrar";
  }
};
