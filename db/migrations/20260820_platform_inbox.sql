begin;

create table if not exists whatsapp_inbox_conversations (
  id uuid primary key default gen_random_uuid(), project_key text not null,
  channel text not null, contact_key text not null, display_name text null,
  status text not null default 'ai_active', assigned_user_id text null,
  assigned_email text null, handoff_reason text null, handoff_summary text null,
  handoff_notified_at timestamptz null, last_message_at timestamptz not null default now(),
  last_inbound_at timestamptz null, last_outbound_at timestamptz null,
  unread_count int not null default 0, metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (channel in ('whatsapp', 'messenger')),
  check (status in ('ai_active', 'waiting_human', 'human_active', 'closed')),
  unique (project_key, channel, contact_key)
);
create index if not exists whatsapp_inbox_conversations_queue_idx
  on whatsapp_inbox_conversations(project_key, status, last_message_at desc);

create table if not exists whatsapp_inbox_messages (
  id uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references whatsapp_inbox_conversations(id) on delete cascade,
  external_message_id text null, direction text not null, actor text not null,
  actor_user_id text null, actor_email text null, kind text not null default 'text',
  content text not null default '', rich jsonb not null default '[]'::jsonb,
  delivery_status text not null default 'received', error text null,
  metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  check (direction in ('inbound', 'outbound')),
  check (actor in ('contact', 'ai', 'human', 'system')),
  check (delivery_status in ('received', 'queued', 'sent', 'delivered', 'read', 'failed'))
);
create index if not exists whatsapp_inbox_messages_thread_idx
  on whatsapp_inbox_messages(conversation_id, created_at, id);
create unique index if not exists whatsapp_inbox_messages_external_uq
  on whatsapp_inbox_messages(conversation_id, external_message_id)
  where external_message_id is not null;

create table if not exists whatsapp_inbox_events (
  id bigserial primary key,
  conversation_id uuid not null references whatsapp_inbox_conversations(id) on delete cascade,
  event_type text not null, actor_user_id text null, actor_email text null,
  payload jsonb not null default '{}'::jsonb, created_at timestamptz not null default now()
);
create index if not exists whatsapp_inbox_events_conversation_idx
  on whatsapp_inbox_events(conversation_id, created_at desc);

commit;
