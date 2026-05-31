import type { ChatMessage } from "../../ai/types.js";
import type {
  ConversationAppendInput,
  ConversationLoadInput,
  ConversationStore,
  PgLike
} from "./store.js";

/**
 * Persistencia del historial de conversación en `whatsapp_agent_messages`
 * (ver db/schema.sql). Sobrevive a reinicios del proceso.
 */
export class PostgresConversationStore implements ConversationStore {
  constructor(private readonly pg: PgLike) {}

  async load(input: ConversationLoadInput): Promise<ChatMessage[]> {
    const { rows } = await this.pg.query(
      `select role, content
         from whatsapp_agent_messages
        where project_key = $1 and phone_e164 = $2 and expires_at > now()
        order by id desc
        limit $3`,
      [input.projectKey, input.phoneE164, input.limit]
    );
    return rows
      .map((row) => ({
        role: String(row.role) as ChatMessage["role"],
        content: String(row.content ?? "")
      }))
      .reverse();
  }

  async append(input: ConversationAppendInput): Promise<void> {
    const messages = input.messages.filter((m) => m.content && m.content.trim());
    if (!messages.length) return;

    // $1 project_key, $2 phone_e164, $3 ttl interval; luego (role, content) por mensaje.
    const values: unknown[] = [input.projectKey, input.phoneE164, `${input.ttlSeconds} seconds`];
    const tuples = messages.map((m, index) => {
      const base = index * 2;
      values.push(m.role, m.content);
      return `($1, $2, $${base + 4}, $${base + 5}, now() + ($3)::interval)`;
    });

    await this.pg.query(
      `insert into whatsapp_agent_messages (project_key, phone_e164, role, content, expires_at)
       values ${tuples.join(", ")}`,
      values
    );
  }

  async prune(): Promise<void> {
    await this.pg.query(`delete from whatsapp_agent_messages where expires_at <= now()`);
  }
}
