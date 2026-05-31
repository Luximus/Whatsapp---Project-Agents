import type { ChatMessage } from "../../ai/types.js";
import type {
  ConversationAppendInput,
  ConversationLoadInput,
  ConversationRole,
  ConversationStore
} from "./store.js";

type StoredMessage = { role: ConversationRole; content: string; expiresAt: number };

// Tope de mensajes retenidos por conversación en memoria (evita crecer sin fin).
const MAX_RETAINED = 100;

/**
 * Historial en memoria del proceso. Fallback cuando no hay pool de Postgres.
 * OJO: un reinicio del proceso lo borra (usar PostgresConversationStore en prod).
 */
export class MemoryConversationStore implements ConversationStore {
  private readonly byKey = new Map<string, StoredMessage[]>();

  private key(projectKey: string, phoneE164: string) {
    return `${projectKey}:${phoneE164}`;
  }

  async load(input: ConversationLoadInput): Promise<ChatMessage[]> {
    const now = Date.now();
    const alive = (this.byKey.get(this.key(input.projectKey, input.phoneE164)) ?? []).filter(
      (m) => m.expiresAt > now
    );
    return alive.slice(-input.limit).map((m) => ({ role: m.role, content: m.content }));
  }

  async append(input: ConversationAppendInput): Promise<void> {
    const key = this.key(input.projectKey, input.phoneE164);
    const expiresAt = Date.now() + input.ttlSeconds * 1000;
    const list = this.byKey.get(key) ?? [];
    for (const m of input.messages) {
      if (m.content && m.content.trim()) {
        list.push({ role: m.role, content: m.content, expiresAt });
      }
    }
    this.byKey.set(key, list.slice(-MAX_RETAINED));
  }

  async prune(): Promise<void> {
    const now = Date.now();
    for (const [key, list] of this.byKey) {
      const alive = list.filter((m) => m.expiresAt > now);
      if (alive.length) this.byKey.set(key, alive);
      else this.byKey.delete(key);
    }
  }
}
