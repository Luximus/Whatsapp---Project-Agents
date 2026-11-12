import type { FastifyInstance } from "fastify";
import { sendWhatsappTypingIndicator } from "./whatsapp.js";

export const HUMAN_TYPING_INTERVAL_MS = 25_000;

/** Presence belongs to the current human owner and never contains their draft. */
export async function sendInboxTyping(
  fastify: FastifyInstance,
  projectKey: string,
  id: string,
  userId: string
) {
  const client = await fastify.pg.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout = '2s'");
    const result = await client.query(
      `select c.channel, c.status, c.assigned_user_id, c.metadata,
         (select external_message_id from whatsapp_inbox_messages m
          where m.conversation_id=c.id and m.direction='inbound' and m.external_message_id is not null
          and m.created_at > now() - interval '24 hours'
          order by m.created_at desc, m.id desc limit 1) as message_id
       from whatsapp_inbox_conversations c where c.id=$1 and c.project_key=$2 for update of c`,
      [id, projectKey]
    );
    const row = result.rows[0];
    if (!row) throw Object.assign(new Error("conversation_not_found"), { statusCode: 404 });
    if (row.status !== "human_active" || row.assigned_user_id !== userId) {
      throw Object.assign(new Error("conversation_not_owned"), { statusCode: 409 });
    }
    let reason: string | undefined;
    if (row.channel !== "whatsapp") reason = "unsupported_channel";
    else if (!row.message_id) reason = "no_recent_inbound_message";
    else if (Date.now() - Date.parse(row.metadata?.humanTypingAt ?? "") < HUMAN_TYPING_INTERVAL_MS)
      reason = "throttled";
    if (reason) {
      await client.query("commit");
      return { sent: false, reason };
    }
    // Hold the ownership lock while sending: a close/claim cannot overtake this signal.
    await sendWhatsappTypingIndicator(String(row.message_id));
    await client.query(
      `update whatsapp_inbox_conversations set metadata=jsonb_set(coalesce(metadata,'{}'::jsonb),'{humanTypingAt}',to_jsonb($2::text)) where id=$1`,
      [id, new Date().toISOString()]
    );
    await client.query("commit");
    return { sent: true };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
