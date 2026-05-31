/**
 * Catálogos de mensajes de usuario por idioma.
 *
 * Las claves son estables (no traducir); los valores son los textos visibles.
 * Para añadir un idioma: agregar una entrada con las mismas claves.
 */
export const SUPPORTED_LOCALES = ["es", "en", "pt"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];
export const DEFAULT_LOCALE: Locale = "es";

export type MessageKey =
  | "verification_help"
  | "audio_transcription_failed"
  | "code_verified"
  | "code_invalid_or_expired"
  | "link_otp_code"
  | "link_confirmed"
  | "link_code_invalid"
  | "auth_ok"
  | "auth_retry_seed";

type Catalog = Record<MessageKey, string>;

const CATALOGS: Record<Locale, Catalog> = {
  es: {
    verification_help:
      "Este numero solo procesa codigos de verificacion. Envia el codigo que recibiste en la app para continuar.",
    audio_transcription_failed:
      "Recibi tu nota de voz, pero no pude transcribirla. Puedes reenviarla o escribir tu mensaje en texto.",
    code_verified: "Codigo verificado. Vuelve a la app para continuar.",
    code_invalid_or_expired: "Codigo invalido o expirado. Genera uno nuevo en la app.",
    link_otp_code:
      "Tu codigo para vincular la cuenta es {code}. Vence en unos minutos. Respondeme con ese codigo para confirmar el vinculo.",
    link_confirmed:
      "Listo, vinculé tu cuenta de {service}. Ya puedes preguntarme por tu cuenta o pedirme que opere tu servidor.",
    link_code_invalid: "Ese codigo no es valido o ya expiro. Revisa tu app de autenticacion (2FA) e intenta de nuevo.",
    auth_ok: "Autenticado con 2FA. Tu sesion estara activa mientras sigas usandola; tras 1 hora de inactividad se cerrara por seguridad.",
    auth_retry_seed: "Ya verifique mi identidad con el codigo 2FA. Continua con lo que te pedi antes; si no habia nada pendiente, preguntame en que ayudo."
  },
  en: {
    verification_help:
      "This number only processes verification codes. Send the code you received in the app to continue.",
    audio_transcription_failed:
      "I got your voice note, but couldn't transcribe it. Please resend it or type your message.",
    code_verified: "Code verified. Go back to the app to continue.",
    code_invalid_or_expired: "Invalid or expired code. Generate a new one in the app.",
    link_otp_code:
      "Your code to link the account is {code}. It expires in a few minutes. Reply with that code to confirm the link.",
    link_confirmed:
      "Done, I linked your {service} account. You can now ask me about your account or have me operate your server.",
    link_code_invalid: "That code is invalid or expired. Check your authenticator (2FA) app and try again.",
    auth_ok: "Authenticated with 2FA. Your session stays active while you use it; after 1 hour of inactivity it closes for security.",
    auth_retry_seed: "I just verified my identity with the 2FA code. Continue with what I asked before; if nothing was pending, ask me how you can help."
  },
  pt: {
    verification_help:
      "Este numero processa apenas codigos de verificacao. Envie o codigo que recebeu no app para continuar.",
    audio_transcription_failed:
      "Recebi sua nota de voz, mas nao consegui transcreve-la. Reenvie ou escreva sua mensagem em texto.",
    code_verified: "Codigo verificado. Volte ao app para continuar.",
    code_invalid_or_expired: "Codigo invalido ou expirado. Gere um novo no app.",
    link_otp_code:
      "Seu codigo para vincular a conta e {code}. Expira em alguns minutos. Responda com esse codigo para confirmar o vinculo.",
    link_confirmed:
      "Pronto, vinculei sua conta de {service}. Agora pode me perguntar sobre sua conta ou pedir que eu opere seu servidor.",
    link_code_invalid: "Esse codigo e invalido ou expirou. Verifique seu app autenticador (2FA) e tente de novo.",
    auth_ok: "Autenticado com 2FA. Sua sessao fica ativa enquanto a usar; apos 1 hora de inatividade fecha por seguranca.",
    auth_retry_seed: "Acabei de verificar minha identidade com o codigo 2FA. Continue com o que pedi antes; se nao havia nada pendente, pergunte como posso ajudar."
  }
};

export function isLocale(value: string): value is Locale {
  return (SUPPORTED_LOCALES as readonly string[]).includes(value);
}

/** Traduce una clave al locale dado, con fallback al idioma por defecto. */
export function t(key: MessageKey, locale: Locale = DEFAULT_LOCALE): string {
  const catalog = CATALOGS[locale] ?? CATALOGS[DEFAULT_LOCALE];
  return catalog[key] ?? CATALOGS[DEFAULT_LOCALE][key];
}

export { CATALOGS };
