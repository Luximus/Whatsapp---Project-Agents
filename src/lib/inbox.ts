import type { FastifyInstance } from "fastify";

export type InboxChannel = "whatsapp" | "messenger";
export type InboxStatus = "ai_active" | "waiting_human" | "human_active" | "closed";

export type InboxConversation = {
  id: string;
  projectKey: string;
  channel: InboxChannel;
  contactKey: string;
  displayName: string | null;
  status: InboxStatus;
  assignedUserId: string | null;
  assignedEmail: string | null;
  handoffReason: string | null;
  handoffSummary: string | null;
  handoffNotifiedAt: Date | null;
  lastMessageAt: Date;
  lastInboundAt: Date | null;
  lastOutboundAt: Date | null;
  unreadCount: number;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
};

export type InboxMessage = {
  id: string;
  conversationId: string;
  externalMessageId: string | null;
  direction: "inbound" | "outbound";
  actor: "contact" | "ai" | "human" | "system";
  actorUserId: string | null;
  actorEmail: string | null;
  kind: string;
  content: string;
  rich: unknown[];
  deliveryStatus: string;
  error: string | null;
  metadata: Record<string, unknown>;
  createdAt: Date;
};

const mapConversation = (row: any): InboxConversation => ({
  id: String(row.id),
  projectKey: String(row.project_key),
  channel: row.channel,
  contactKey: String(row.contact_key),
  displayName: row.display_name ? String(row.display_name) : null,
  status: row.status,
  assignedUserId: row.assigned_user_id ? String(row.assigned_user_id) : null,
  assignedEmail: row.assigned_email ? String(row.assigned_email) : null,
  handoffReason: row.handoff_reason ? String(row.handoff_reason) : null,
  handoffSummary: row.handoff_summary ? String(row.handoff_summary) : null,
  handoffNotifiedAt: row.handoff_notified_at ?? null,
  lastMessageAt: row.last_message_at,
  lastInboundAt: row.last_inbound_at ?? null,
  lastOutboundAt: row.last_outbound_at ?? null,
  unreadCount: Number(row.unread_count ?? 0),
  metadata: row.metadata ?? {},
  createdAt: row.created_at,
  updatedAt: row.updated_at
});

const mapMessage = (row: any): InboxMessage => ({
  id: String(row.id),
  conversationId: String(row.conversation_id),
  externalMessageId: row.external_message_id ? String(row.external_message_id) : null,
  direction: row.direction,
  actor: row.actor,
  actorUserId: row.actor_user_id ? String(row.actor_user_id) : null,
  actorEmail: row.actor_email ? String(row.actor_email) : null,
  kind: String(row.kind),
  content: String(row.content ?? ""),
  rich: Array.isArray(row.rich) ? row.rich : [],
  deliveryStatus: String(row.delivery_status),
  error: row.error ? String(row.error) : null,
  metadata: row.metadata ?? {},
  createdAt: row.created_at
});

export async function ensureInboxConversation(
  fastify: FastifyInstance,
  input: {
    projectKey: string;
    channel: InboxChannel;
    contactKey: string;
    displayName?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<InboxConversation> {
  const result = await fastify.pg.query(
    `insert into whatsapp_inbox_conversations
       (project_key, channel, contact_key, display_name, metadata)
     values ($1,$2,$3,$4,$5::jsonb)
     on conflict (project_key, channel, contact_key) do update set
       display_name=coalesce(nullif(excluded.display_name,''), whatsapp_inbox_conversations.display_name),
       metadata=whatsapp_inbox_conversations.metadata || excluded.metadata,
       updated_at=now()
     returning *`,
    [input.projectKey, input.channel, input.contactKey, input.displayName ?? null, JSON.stringify(input.metadata ?? {})]
  );
  return mapConversation(result.rows[0]);
}

export async function recordInboxInbound(
  fastify: FastifyInstance,
  input: {
    projectKey: string;
    channel: InboxChannel;
    contactKey: string;
    displayName?: string | null;
    externalMessageId?: string | null;
    kind?: string;
    content: string;
    metadata?: Record<string, unknown>;
  }
): Promise<InboxConversation> {
  const conversation = await ensureInboxConversation(fastify, input);
  const inserted = await fastify.pg.query(
    `insert into whatsapp_inbox_messages
       (conversation_id, external_message_id, direction, actor, kind, content, metadata)
     values ($1,$2,'inbound','contact',$3,$4,$5::jsonb)
     on conflict (conversation_id, external_message_id) where external_message_id is not null do nothing
     returning id`,
    [conversation.id, input.externalMessageId ?? null, input.kind ?? "text", input.content, JSON.stringify(input.metadata ?? {})]
  );
  if (inserted.rowCount) {
    const updated = await fastify.pg.query(
      `update whatsapp_inbox_conversations set
         status=case when status='closed' then 'ai_active' else status end,
         last_message_at=now(), last_inbound_at=now(), unread_count=unread_count+1, updated_at=now()
       where id=$1 returning *`,
      [conversation.id]
    );
    return mapConversation(updated.rows[0]);
  }
  return conversation;
}

export async function recordInboxOutbound(
  fastify: FastifyInstance,
  input: {
    conversationId: string;
    externalMessageId?: string | null;
    actor: "ai" | "human" | "system";
    actorUserId?: string | null;
    actorEmail?: string | null;
    kind?: string;
    content: string;
    rich?: unknown[];
    deliveryStatus?: "queued" | "sent" | "delivered" | "read" | "failed";
    error?: string | null;
    metadata?: Record<string, unknown>;
  }
): Promise<InboxMessage> {
  const result = await fastify.pg.query(
    `insert into whatsapp_inbox_messages
       (conversation_id, external_message_id, direction, actor, actor_user_id, actor_email,
        kind, content, rich, delivery_status, error, metadata)
     values ($1,$2,'outbound',$3,$4,$5,$6,$7,$8::jsonb,$9,$10,$11::jsonb)
     returning *`,
    [
      input.conversationId,
      input.externalMessageId ?? null,
      input.actor,
      input.actorUserId ?? null,
      input.actorEmail ?? null,
      input.kind ?? "text",
      input.content,
      JSON.stringify(input.rich ?? []),
      input.deliveryStatus ?? "sent",
      input.error ?? null,
      JSON.stringify(input.metadata ?? {})
    ]
  );
  await fastify.pg.query(
    `update whatsapp_inbox_conversations
     set last_message_at=now(), last_outbound_at=now(), updated_at=now()
     where id=$1`,
    [input.conversationId]
  );
  return mapMessage(result.rows[0]);
}

export async function listInboxConversations(
  fastify: FastifyInstance,
  projectKey: string,
  input: { status?: InboxStatus; channel?: InboxChannel; limit?: number; search?: string }
) {
  const values: unknown[] = [projectKey];
  const where = ["project_key=$1"];
  if (input.status) { values.push(input.status); where.push(`status=$${values.length}`); }
  if (input.channel) { values.push(input.channel); where.push(`channel=$${values.length}`); }
  if (input.search) {
    values.push(`%${input.search}%`);
    where.push(`(contact_key ilike $${values.length} or coalesce(display_name,'') ilike $${values.length})`);
  }
  values.push(Math.min(200, Math.max(1, input.limit ?? 100)));
  const result = await fastify.pg.query(
    `select * from whatsapp_inbox_conversations where ${where.join(" and ")}
     order by last_message_at desc limit $${values.length}`,
    values
  );
  return result.rows.map(mapConversation);
}

export async function getInboxConversation(fastify: FastifyInstance, projectKey: string, id: string) {
  const result = await fastify.pg.query(
    "select * from whatsapp_inbox_conversations where id=$1 and project_key=$2 limit 1",
    [id, projectKey]
  );
  return result.rows[0] ? mapConversation(result.rows[0]) : null;
}

export async function listInboxMessages(fastify: FastifyInstance, conversationId: string, limit = 200) {
  const result = await fastify.pg.query(
    `select * from (
       select * from whatsapp_inbox_messages where conversation_id=$1
       order by created_at desc, id desc limit $2
     ) rows order by created_at asc, id asc`,
    [conversationId, Math.min(500, Math.max(1, limit))]
  );
  await fastify.pg.query(
    "update whatsapp_inbox_conversations set unread_count=0, updated_at=now() where id=$1",
    [conversationId]
  );
  return result.rows.map(mapMessage);
}

export async function requestHumanHandoff(
  fastify: FastifyInstance,
  conversationId: string,
  input: { reason?: string; summary?: string; actor?: string }
) {
  const result = await fastify.pg.query(
    `update whatsapp_inbox_conversations set
       status='waiting_human', assigned_user_id=null, assigned_email=null,
       handoff_reason=$2, handoff_summary=$3, updated_at=now()
     where id=$1 and status in ('ai_active','closed') returning *`,
    [conversationId, input.reason ?? "Atención humana solicitada", input.summary ?? ""]
  );
  if (!result.rows[0]) return null;
  await fastify.pg.query(
    "insert into whatsapp_inbox_events (conversation_id,event_type,payload) values ($1,'handoff_requested',$2::jsonb)",
    [conversationId, JSON.stringify({ ...input })]
  );
  return mapConversation(result.rows[0]);
}

export async function markHandoffNotified(fastify: FastifyInstance, conversationId: string) {
  await fastify.pg.query(
    "update whatsapp_inbox_conversations set handoff_notified_at=coalesce(handoff_notified_at,now()), updated_at=now() where id=$1",
    [conversationId]
  );
}

export async function markInboxCommercialSignal(
  fastify: FastifyInstance,
  conversationId: string,
  input: { reason: string; service?: string; actor?: string }
) {
  const payload = {
    qualified: true,
    reason: input.reason.trim().slice(0, 500),
    service: input.service?.trim().slice(0, 120) || null,
    detectedAt: new Date().toISOString(),
    actor: input.actor || "ai"
  };
  const result = await fastify.pg.query(
    `update whatsapp_inbox_conversations set
       metadata=metadata || jsonb_build_object('commercialSignal',$2::jsonb), updated_at=now()
     where id=$1 returning *`,
    [conversationId, JSON.stringify(payload)]
  );
  if (!result.rows[0]) return null;
  await fastify.pg.query(
    "insert into whatsapp_inbox_events (conversation_id,event_type,payload) values ($1,'commercial_signal',$2::jsonb)",
    [conversationId, JSON.stringify(payload)]
  );
  return mapConversation(result.rows[0]);
}

export async function claimInboxConversation(
  fastify: FastifyInstance,
  projectKey: string,
  id: string,
  actor: { userId: string; email: string; force?: boolean }
) {
  const result = await fastify.pg.query(
    `update whatsapp_inbox_conversations set
       status='human_active', assigned_user_id=$3, assigned_email=$4, updated_at=now()
     where id=$1 and project_key=$2
       and ($5::boolean or assigned_user_id is null or assigned_user_id=$3)
     returning *`,
    [id, projectKey, actor.userId, actor.email, actor.force === true]
  );
  if (!result.rows[0]) return null;
  await fastify.pg.query(
    `insert into whatsapp_inbox_events
       (conversation_id,event_type,actor_user_id,actor_email,payload)
     values ($1,'conversation_claimed',$2,$3,'{}'::jsonb)`,
    [id, actor.userId, actor.email]
  );
  return mapConversation(result.rows[0]);
}

export async function closeInboxConversation(
  fastify: FastifyInstance,
  projectKey: string,
  id: string,
  actor: { userId: string; email: string; summary?: string }
) {
  const result = await fastify.pg.query(
    `update whatsapp_inbox_conversations set
       status='ai_active', assigned_user_id=null, assigned_email=null,
       handoff_summary=case when $5='' then handoff_summary else $5 end,
       unread_count=0, updated_at=now()
     where id=$1 and project_key=$2 and (assigned_user_id=$3 or assigned_user_id is null)
     returning *`,
    [id, projectKey, actor.userId, actor.email, actor.summary ?? ""]
  );
  if (!result.rows[0]) return null;
  await fastify.pg.query(
    `insert into whatsapp_inbox_events
       (conversation_id,event_type,actor_user_id,actor_email,payload)
     values ($1,'conversation_closed',$2,$3,$4::jsonb)`,
    [id, actor.userId, actor.email, JSON.stringify({ summary: actor.summary ?? "" })]
  );
  return mapConversation(result.rows[0]);
}
