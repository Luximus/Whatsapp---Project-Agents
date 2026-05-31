/**
 * Tool: lista los servicios que este número de WhatsApp tiene vinculados.
 */
export default {
  name: "listLinkedAccounts",
  description:
    "Lista las cuentas/servicios que este número de WhatsApp tiene vinculados. Úsala antes de consultar una cuenta si no sabes si está vinculada.",
  parameters: {
    type: "object",
    properties: {},
    additionalProperties: false
  },
  async execute(_args, context) {
    const list = context?.actions?.listLinks;
    if (typeof list !== "function") {
      return "error: servicios_no_disponibles";
    }
    const res = await list();
    const accounts = res?.accounts ?? [];
    if (!accounts.length) {
      return "info: este número no tiene cuentas vinculadas. Usa linkAccount para vincular una (lp, luxipanel, luxichat).";
    }
    return (
      "vinculadas:\n" +
      accounts
        .map((a) => `- ${a.serviceName}${a.displayName ? ` (${a.displayName})` : ""} [${a.serviceId}]`)
        .join("\n")
    );
  }
};
