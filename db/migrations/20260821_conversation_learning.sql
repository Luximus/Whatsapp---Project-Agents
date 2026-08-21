begin;

create index if not exists whatsapp_inbox_messages_retention_idx on whatsapp_inbox_messages(created_at);

create table if not exists whatsapp_learning_runs (
  id uuid primary key default gen_random_uuid(), project_key text not null, date_key date not null,
  period_start timestamptz not null, period_end timestamptz not null, status text not null default 'pending',
  conversation_count int not null default 0, analyzed_count int not null default 0,
  failed_count int not null default 0, proposal_count int not null default 0,
  metrics jsonb not null default '{}'::jsonb, error text, started_at timestamptz, completed_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check (status in ('pending','running','completed','partial','failed')), unique(project_key,date_key)
);
create index if not exists whatsapp_learning_runs_status_idx on whatsapp_learning_runs(project_key,status,date_key desc);

create table if not exists whatsapp_learning_conversation_reviews (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references whatsapp_learning_runs(id) on delete cascade,
  conversation_id uuid references whatsapp_inbox_conversations(id) on delete set null, channel text not null,
  message_count int not null default 0, status text not null default 'pending', provider text, model text,
  analysis jsonb not null default '{}'::jsonb, error text, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(), check(channel in ('whatsapp','messenger')),
  check(status in ('pending','running','completed','failed')), unique(run_id,conversation_id)
);

create table if not exists whatsapp_learning_proposals (
  id uuid primary key default gen_random_uuid(), run_id uuid not null references whatsapp_learning_runs(id) on delete cascade,
  project_key text not null, rule_key text not null, category text not null, priority text not null default 'medium',
  channel_scope text not null default 'all', title text not null, rationale text not null,
  expected_outcome text not null, suggested_change text not null, evidence jsonb not null default '[]'::jsonb,
  confidence numeric(5,4) not null default 0, status text not null default 'pending',
  analysis_provider text, analysis_model text, decided_by_user_id text, decided_by_email text,
  decision_reason text, decided_at timestamptz, published_at timestamptz, rolled_back_at timestamptz,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  check(priority in ('low','medium','high','critical')), check(channel_scope in ('all','whatsapp','messenger')),
  check(status in ('pending','generating','ready_for_review','discarded','publishing','published','failed','rolled_back')),
  unique(run_id,rule_key)
);
create index if not exists whatsapp_learning_proposals_queue_idx on whatsapp_learning_proposals(project_key,status,created_at desc);

create table if not exists whatsapp_learning_change_jobs (
  id uuid primary key default gen_random_uuid(), proposal_id uuid not null references whatsapp_learning_proposals(id) on delete cascade,
  status text not null default 'queued', base_sha text, branch_name text, worktree_path text, provider text, model text,
  attempt int not null default 0, changed_files jsonb not null default '[]'::jsonb, diff_text text not null default '',
  checks jsonb not null default '[]'::jsonb, commit_sha text, error text, requested_by_user_id text,
  requested_by_email text, published_by_user_id text, published_by_email text, started_at timestamptz,
  completed_at timestamptz, published_at timestamptz, created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check(status in ('queued','running','ready_for_review','publishing','published','rollback_queued','rolling_back','failed','discarded','rolled_back'))
);
create index if not exists whatsapp_learning_change_jobs_queue_idx on whatsapp_learning_change_jobs(status,created_at);

create table if not exists whatsapp_learning_events (
  id bigserial primary key, proposal_id uuid references whatsapp_learning_proposals(id) on delete cascade,
  job_id uuid references whatsapp_learning_change_jobs(id) on delete cascade, event_type text not null,
  actor_user_id text, actor_email text, payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index if not exists whatsapp_learning_events_proposal_idx on whatsapp_learning_events(proposal_id,created_at desc);

commit;
