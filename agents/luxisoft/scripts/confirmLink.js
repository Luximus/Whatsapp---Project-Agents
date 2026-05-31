/**
 * Tool: confirma el vínculo con el código que la persona recibió por WhatsApp
 * tras `linkAccount`. Al verificarse, el número queda vinculado a la cuenta.
 */
export default {
  name: "confirmLink",
  description:
    "Confirma el vínculo de una cuenta usando el código 2FA (TOTP) de la app de autenticación de la persona, tras linkAccount. " +
    "Servicios: lp | luxipanel | luxichat.",
  parameters: {
    type: "object",
    properties: {
      service: { type: "string", description: "Servicio en proceso de vínculo: lp | luxipanel | luxichat." },
      code: { type: "string", description: "Código 2FA (TOTP) de la app de autenticación de la persona." }
    },
    required: ["service", "code"],
    additionalProperties: false
  },
  async execute(args, context) {
    const confirm = context?.actions?.confirmLink;
    if (typeof confirm !== "function") {
      return "error: servicios_no_disponibles";
    }
    const service = String(args?.service ?? "").trim();
    const code = String(args?.code ?? "").trim();
    if (!service) return "error: falta_servicio";
    if (!code) return "error: falta_codigo";

    // Guarda anti-encadenado: el código 2FA (TOTP) es SIEMPRE numérico (4-8
    // dígitos). Si llega cualquier otra cosa (un "sí", texto, o un código
    // inventado), NO lo reenvíes al servicio: detente y pide el código real a la
    // persona. Esto evita el bug de confirmar con un código fabricado sin haberlo
    // pedido. El código real, cuando la persona lo escribe, lo confirma el webhook
    // de forma determinista; normalmente NO necesitas llamar a esta tool tú.
    if (!/^\d{4,8}$/.test(code)) {
      return "error: codigo_invalido_no_pedido. AÚN no tienes el código 2FA de la persona. Detente y PÍDESELO (son 4-8 dígitos de su app de autenticación). NUNCA inventes, asumas ni uses 'sí' como código.";
    }

    const res = await confirm({ service, code });
    const name = res?.serviceName || service;
    switch (res?.status) {
      case "linked":
        return `ok: cuenta de ${name} vinculada${res.displayName ? ` (${res.displayName})` : ""} y autenticada con 2FA. Ya puedes consultar su cuenta/perfil con getAccountInfo.`;
      case "invalid":
        return "error: codigo_2fa_incorrecto. Pídele el código actual de su app de autenticación (cambia cada 30s).";
      case "expired":
        return "error: codigo_expirado. Vuelve a iniciar el vínculo con linkAccount.";
      case "none":
        return "error: no_hay_vinculo_pendiente. Usa linkAccount primero.";
      case "unknown_service":
        return "error: servicio_desconocido. Servicios válidos: lp, luxipanel, luxichat.";
      default:
        return `error: no_pude_confirmar${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
