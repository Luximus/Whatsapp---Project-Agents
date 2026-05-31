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
  | "code_invalid_or_expired";

type Catalog = Record<MessageKey, string>;

const CATALOGS: Record<Locale, Catalog> = {
  es: {
    verification_help:
      "Este numero solo procesa codigos de verificacion. Envia el codigo que recibiste en la app para continuar.",
    audio_transcription_failed:
      "Recibi tu nota de voz, pero no pude transcribirla. Puedes reenviarla o escribir tu mensaje en texto.",
    code_verified: "Codigo verificado. Vuelve a la app para continuar.",
    code_invalid_or_expired: "Codigo invalido o expirado. Genera uno nuevo en la app."
  },
  en: {
    verification_help:
      "This number only processes verification codes. Send the code you received in the app to continue.",
    audio_transcription_failed:
      "I got your voice note, but couldn't transcribe it. Please resend it or type your message.",
    code_verified: "Code verified. Go back to the app to continue.",
    code_invalid_or_expired: "Invalid or expired code. Generate a new one in the app."
  },
  pt: {
    verification_help:
      "Este numero processa apenas codigos de verificacao. Envie o codigo que recebeu no app para continuar.",
    audio_transcription_failed:
      "Recebi sua nota de voz, mas nao consegui transcreve-la. Reenvie ou escreva sua mensagem em texto.",
    code_verified: "Codigo verificado. Volte ao app para continuar.",
    code_invalid_or_expired: "Codigo invalido ou expirado. Gere um novo no app."
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
