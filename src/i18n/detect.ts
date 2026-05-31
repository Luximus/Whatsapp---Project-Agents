import { DEFAULT_LOCALE, isLocale, type Locale } from "./messages.js";

// Pistas léxicas mínimas por idioma. Es una heurística barata para WhatsApp,
// no un detector estadístico: prioriza decisiones rápidas y deterministas.
const HINTS: Record<Exclude<Locale, "es">, RegExp[]> = {
  en: [
    /\b(the|hello|hi|please|thanks|thank you|code|help|how|what|need|want)\b/i
  ],
  pt: [/\b(ola|obrigad[oa]|por favor|voce|codigo|ajuda|preciso|quero|nao)\b/i]
};

/**
 * Detecta el idioma de un texto corto de WhatsApp.
 * Estrategia: si hay pistas claras de en/pt las usa; si no, español (default
 * del negocio). Pensado para mensajes breves y ruidosos.
 */
export function detectLocale(text: string | null | undefined): Locale {
  const value = String(text ?? "").trim();
  if (!value) return DEFAULT_LOCALE;

  for (const [locale, patterns] of Object.entries(HINTS)) {
    if (patterns.some((pattern) => pattern.test(value))) {
      return locale as Locale;
    }
  }
  return DEFAULT_LOCALE;
}

/** Resuelve un locale explícito (p.ej. de perfil de usuario) o detecta. */
export function resolveLocale(input: {
  explicit?: string | null;
  text?: string | null;
}): Locale {
  const explicit = String(input.explicit ?? "").trim().toLowerCase();
  if (explicit && isLocale(explicit)) return explicit;
  return detectLocale(input.text);
}
