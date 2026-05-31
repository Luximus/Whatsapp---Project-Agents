/**
 * Tool: inicia el vínculo del número de WhatsApp con la cuenta de un servicio
 * (LP/cuenta LUXISOFT, LUXIPANEL, LuxiChat...). Si encuentra una cuenta cuyo
 * teléfono registrado coincide con este número, envía un código por WhatsApp.
 *
 * El código se entrega en el chat (la capa de rutas lo envía); NO lo verás ni
 * debes inventarlo. Tras llamar a esta tool, pídele a la persona el código y
 * luego usa `confirmLink`.
 */
export default {
  name: "linkAccount",
  description:
    "Inicia el vínculo del número de WhatsApp con la cuenta de un servicio para poder consultar su cuenta/perfil. " +
    "Servicios válidos: 'lp' (cuenta LUXISOFT), 'luxipanel', 'luxichat'. " +
    "Requiere que el número de WhatsApp sea el mismo registrado en la cuenta Y que la cuenta tenga 2FA activo. " +
    "Tras llamarla, pídele a la persona el código de su app de autenticación (2FA) y úsalo con confirmLink.",
  parameters: {
    type: "object",
    properties: {
      service: {
        type: "string",
        description: "Servicio a vincular: lp | luxipanel | luxichat."
      }
    },
    required: ["service"],
    additionalProperties: false
  },
  async execute(args, context) {
    const start = context?.actions?.startLink;
    if (typeof start !== "function") {
      return "error: servicios_no_disponibles";
    }
    const service = String(args?.service ?? "").trim();
    if (!service) return "error: falta_servicio";

    const res = await start({ service });
    const name = res?.serviceName || service;
    switch (res?.status) {
      case "need_2fa_code":
        return `ok: encontré la cuenta de ${name}${res.displayName ? ` (${res.displayName})` : ""}. Pídele el código de su app de autenticación (2FA) y confírmalo con confirmLink. NO le pidas la contraseña.`;
      case "needs_2fa":
        return `error: la cuenta de ${name} NO tiene 2FA activo. Por seguridad, el vínculo requiere 2FA: dile que primero active la verificación en dos pasos (2FA/TOTP) en su cuenta y luego vuelva a intentar.`;
      case "2fa_unavailable":
        return `error: ${name} no permite verificar 2FA por este canal, así que no puede vincularse aquí.`;
      case "already_linked":
        return `info: la cuenta de ${name} ya está vinculada a este número. Puedes usar getAccountInfo (puede pedir 2FA si la sesión expiró).`;
      case "not_found":
        return `error: no_encontre_cuenta_de_${service}. El número de WhatsApp debe ser el mismo teléfono registrado en la cuenta. Sugiérele revisar el teléfono de su perfil.`;
      case "unknown_service":
        return "error: servicio_desconocido. Servicios válidos: lp, luxipanel, luxichat.";
      case "unavailable":
        return `error: ${name} no está disponible para vincular ahora.`;
      default:
        return `error: no_pude_iniciar_el_vinculo${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
