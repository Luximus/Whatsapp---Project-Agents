import { env } from "../../../env.js";
import type { ChatMessage } from "../../ai/types.js";
import { getConversationStore, type ConversationStoreHost } from "./factory.js";

export * from "./store.js";
export { getConversationStore, resetConversationStores } from "./factory.js";
export type { ConversationStoreHost } from "./factory.js";

/**
 * Carga el historial reciente de la conversación con un número. Tolerante a
 * fallos: si la lectura falla, devuelve historial vacío para no romper el
 * webhook (el agente simplemente responde sin contexto previo).
 */
export async function loadConversationHistory(
  host: ConversationStoreHost,
  input: { projectKey: string; phoneE164: string }
): Promise<ChatMessage[]> {
  const store = getConversationStore(host);
  try {
    return await store.load({
      projectKey: input.projectKey,
      phoneE164: input.phoneE164,
      limit: env.WHATSAPP_AGENT_MEMORY_MAX_MESSAGES
    });
  } catch (err) {
    host?.log?.warn?.({ err }, "agent_history_load_failed");
    return [];
  }
}

/**
 * Guarda el turno (mensaje del usuario + respuesta del asistente) y poda lo
 * vencido. Tolerante a fallos: un error de persistencia no interrumpe la
 * respuesta ya enviada al usuario.
 */
export async function recordConversationTurn(
  host: ConversationStoreHost,
  input: {
    projectKey: string;
    phoneE164: string;
    userMessage: string;
    assistantMessage: string;
  }
): Promise<void> {
  const store = getConversationStore(host);
  try {
    await store.append({
      projectKey: input.projectKey,
      phoneE164: input.phoneE164,
      ttlSeconds: env.WHATSAPP_AGENT_MEMORY_TTL_SECONDS,
      messages: [
        { role: "user", content: input.userMessage },
        { role: "assistant", content: input.assistantMessage }
      ]
    });
    void store.prune().catch(() => {});
  } catch (err) {
    host?.log?.warn?.({ err }, "agent_history_save_failed");
  }
}
