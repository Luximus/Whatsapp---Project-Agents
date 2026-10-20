import type { FastifyInstance } from "fastify";
import { z } from "zod";

export const inboxTagSchema = z
  .string()
  .trim()
  .min(1)
  .max(40)
  .transform((value) => value.normalize("NFC"));
export const inboxTagsSchema = z
  .array(inboxTagSchema)
  .max(10)
  .transform((values) => [...new Set(values)]);
export const inboxListSchema = z.object({
  status: z.enum(["ai_active", "waiting_human", "human_active", "closed"]).optional(),
  channel: z.enum(["whatsapp", "messenger"]).optional(),
  limit: z.coerce.number().int().min(1).max(200).default(100),
  search: z.string().trim().max(120).optional(),
  tag: inboxTagSchema.optional()
});

/** Filter before LIMIT, including chats outside the first page of the inbox. */
export async function listManagedInbox(
  fastify: FastifyInstance,
  projectKey: string,
  input: z.infer<typeof inboxListSchema>
) {
  const values: unknown[] = [projectKey];
  const where = ["project_key=$1"];
  for (const field of ["status", "channel"] as const) {
    if (input[field]) {
      values.push(input[field]);
      where.push(`${field}=$${values.length}`);
    }
  }
  if (input.search) {
    values.push(input.search);
    where.push(
      `(strpos(lower(contact_key),lower($${values.length}))>0 or strpos(lower(coalesce(display_name,'')),lower($${values.length}))>0)`
    );
  }
  if (input.tag) {
    values.push(JSON.stringify({ tags: [input.tag] }));
    where.push(`metadata @> $${values.length}::jsonb`);
  }
  values.push(input.limit);
  const result = await fastify.pg.query(
    `select * from whatsapp_inbox_conversations where ${where.join(" and ")} order by last_message_at desc,id desc limit $${values.length}`,
    values
  );
  return result.rows.map((row) => ({
    ...Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
        value
      ])
    ),
    tags: inboxTagsSchema.safeParse(row.metadata?.tags).data ?? []
  }));
}

export async function listInboxTags(
  fastify: FastifyInstance,
  projectKey: string
): Promise<string[]> {
  const result = await fastify.pg.query(
    `select distinct tag from whatsapp_inbox_conversations c,
    lateral jsonb_array_elements_text(case when jsonb_typeof(c.metadata->'tags')='array' then c.metadata->'tags' else '[]'::jsonb end) tag
    where c.project_key=$1 order by tag limit 500`,
    [projectKey]
  );
  return result.rows.map((row) => String(row.tag));
}

export async function setInboxTags(
  fastify: FastifyInstance,
  projectKey: string,
  id: string,
  tags: string[]
) {
  const result = await fastify.pg.query(
    `update whatsapp_inbox_conversations
    set metadata=jsonb_set(metadata,'{tags}',$3::jsonb),updated_at=now()
    where id=$1 and project_key=$2 returning id`,
    [id, projectKey, JSON.stringify(tags)]
  );
  return Boolean(result.rows[0]);
}

/** One transaction owns the row, archive, summaries and compatibility memory. */
export async function eraseInboxConversation(
  fastify: FastifyInstance,
  projectKey: string,
  id: string,
  input: { mode: "clear" | "delete"; lastMessageAt: string; userId: string; email: string }
) {
  const client = await fastify.pg.connect();
  try {
    await client.query("begin");
    await client.query("set local lock_timeout='3s'");
    const result = await client.query(
      `select channel,contact_key,last_message_at from whatsapp_inbox_conversations
      where id=$1 and project_key=$2 for update`,
      [id, projectKey]
    );
    const row = result.rows[0];
    if (!row) throw Object.assign(new Error("conversation_not_found"), { statusCode: 404 });
    if (new Date(row.last_message_at).getTime() !== new Date(input.lastMessageAt).getTime()) {
      throw Object.assign(new Error("conversation_changed"), { statusCode: 409 });
    }
    const memoryKey =
      row.channel === "whatsapp" ? row.contact_key : `${row.channel}:${row.contact_key}`;
    await client.query(
      "delete from whatsapp_agent_messages where project_key=$1 and phone_e164=$2",
      [projectKey, memoryKey]
    );
    const removed = await client.query(
      "delete from whatsapp_inbox_messages where conversation_id=$1",
      [id]
    );
    await client.query("delete from whatsapp_inbox_events where conversation_id=$1", [id]);
    if (input.mode === "delete") {
      await client.query(
        "delete from whatsapp_inbox_conversations where id=$1 and project_key=$2",
        [id, projectKey]
      );
    } else {
      await client.query(
        `update whatsapp_inbox_conversations set handoff_reason=null,handoff_summary=null,
        handoff_notified_at=null,unread_count=0,last_inbound_at=null,last_outbound_at=null,
        metadata=metadata-'commercialSignal'-'welcomeMenu',updated_at=now() where id=$1`,
        [id]
      );
      await client.query(
        `insert into whatsapp_inbox_events (conversation_id,event_type,actor_user_id,actor_email,payload)
        values ($1,'history_cleared',$2,$3,'{}'::jsonb)`,
        [id, input.userId, input.email]
      );
    }
    await client.query("commit");
    return { id, mode: input.mode, deletedMessages: removed.rowCount ?? 0 };
  } catch (error) {
    await client.query("rollback");
    throw error;
  } finally {
    client.release();
  }
}
