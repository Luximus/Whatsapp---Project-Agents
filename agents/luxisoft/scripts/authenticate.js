/**
 * Tool: re-autentica el chat con el código 2FA (TOTP) de una cuenta ya
 * vinculada. Úsala cuando una acción devuelva "auth_required" (sesión 2FA
 * expirada por inactividad) y la persona te dé su código de autenticación.
 */
export default {
  name: "authenticate",
  description:
    "Re-autentica el chat con el código 2FA (TOTP) de la app de autenticación de la persona. " +
    "Úsala cuando una acción pida autenticación (sesión expirada). Opcional: service (lp|luxipanel|luxichat).",
  parameters: {
    type: "object",
    properties: {
      code: { type: "string", description: "Código 2FA (TOTP) actual de su app de autenticación." },
      service: { type: "string", description: "Servicio cuya 2FA usar (opcional): lp | luxipanel | luxichat." }
    },
    required: ["code"],
    additionalProperties: false
  },
  async execute(args, context) {
    const auth = context?.actions?.authenticate;
    if (typeof auth !== "function") return "error: servicios_no_disponibles";
    const code = String(args?.code ?? "").trim();
    if (!code) return "error: falta_codigo_2fa";
    const service = String(args?.service ?? "").trim() || undefined;

    const res = await auth({ code, service });
    switch (res?.status) {
      case "authenticated":
        return `ok: autenticado con 2FA (${res.serviceName || "cuenta"}). La sesión queda activa; tras 1 hora de inactividad se cierra y habrá que autenticar de nuevo.`;
      case "invalid":
        return "error: codigo_2fa_incorrecto. Pídele el código actual de su app (cambia cada 30s).";
      case "not_linked":
        return "error: sin_cuenta_vinculada. Primero vincula una cuenta con linkAccount.";
      default:
        return `error: no_pude_autenticar${res?.message ? `: ${res.message}` : ""}`;
    }
  }
};
