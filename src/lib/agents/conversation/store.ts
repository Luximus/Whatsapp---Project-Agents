import type { ChatMessage } from "../../ai/types.js";

/**
 * Memoria de conversación del agente: historial reciente por número de WhatsApp.
 * Solo persistimos los turnos de texto (`user`/`assistant`); las tool calls y
 * sus resultados son efímeros a un turno y NO se guardan (evita ruido y tokens).
 */
export type ConversationRole = "user" | "assistant";

export interface ConversationMessageInput {
  role: ConversationRole;
  content: string;
}

export interface ConversationLoadInput {
  projectKey: string;
  phoneE164: string;
  /** Máximo de mensajes recientes a recuperar (orden cronológico). */
  limit: number;
}

export interface ConversationAppendInput {
  projectKey: string;
  phoneE164: string;
  /** Vida del historial: cada turno renueva el vencimiento (ventana deslizante). */
  ttlSeconds: number;
  messages: ConversationMessageInput[];
}

export interface ConversationStore {
  /** Devuelve los últimos mensajes vivos en orden cronológico (viejo → nuevo). */
  load(input: ConversationLoadInput): Promise<ChatMessage[]>;
  /** Añade los mensajes del turno con un nuevo vencimiento. */
  append(input: ConversationAppendInput): Promise<void>;
  /** Borra el historial vencido. */
  prune(): Promise<void>;
}

/** Mínimo de la API de `pg.Pool` que necesitamos (facilita el mock en tests). */
export interface PgLike {
  query(text: string, values?: unknown[]): Promise<{ rows: any[]; rowCount?: number | null }>;
}
