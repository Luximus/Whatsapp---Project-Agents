create extension if not exists pgcrypto;

create or replace function set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

create table if not exists whatsapp_projects (
  project_key text primary key,
  display_name text not null,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_projects_set_updated_at') then
    create trigger whatsapp_projects_set_updated_at
    before update on whatsapp_projects
    for each row execute function set_updated_at();
  end if;
end $$;

create table if not exists whatsapp_accounts (
  id uuid primary key default gen_random_uuid(),
  project_key text not null references whatsapp_projects(project_key) on delete cascade,
  firebase_uid text not null,
  email text null,
  name text null,
  handle text null,
  phone_e164 varchar(20) null,
  phone_prefix text null,
  phone_local text null,
  whatsapp_verified boolean not null default false,
  whatsapp_verified_at timestamptz null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_key, firebase_uid)
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_accounts_set_updated_at') then
    create trigger whatsapp_accounts_set_updated_at
    before update on whatsapp_accounts
    for each row execute function set_updated_at();
  end if;
end $$;

create unique index if not exists whatsapp_accounts_project_phone_uq
  on whatsapp_accounts(project_key, phone_e164)
  where phone_e164 is not null;
create index if not exists whatsapp_accounts_project_verified_idx
  on whatsapp_accounts(project_key, whatsapp_verified, whatsapp_verified_at desc);

create table if not exists whatsapp_verification_requests (
  id bigserial primary key,
  project_key text not null references whatsapp_projects(project_key) on delete cascade,
  account_id uuid not null references whatsapp_accounts(id) on delete cascade,
  phone_e164 varchar(20) not null,
  code varchar(10) not null,
  expires_at timestamptz not null,
  verified_at timestamptz null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (project_key, account_id)
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_verification_requests_set_updated_at') then
    create trigger whatsapp_verification_requests_set_updated_at
    before update on whatsapp_verification_requests
    for each row execute function set_updated_at();
  end if;
end $$;

create index if not exists whatsapp_verification_requests_phone_idx on whatsapp_verification_requests(phone_e164);
create index if not exists whatsapp_verification_requests_code_idx on whatsapp_verification_requests(code);
create index if not exists whatsapp_verification_requests_expires_idx on whatsapp_verification_requests(expires_at);

create table if not exists whatsapp_login_requests (
  id bigserial primary key,
  project_key text not null references whatsapp_projects(project_key) on delete cascade,
  session_id text not null unique,
  phone_e164 varchar(20) not null,
  code varchar(10) not null,
  expires_at timestamptz not null,
  verified_at timestamptz null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_login_requests_set_updated_at') then
    create trigger whatsapp_login_requests_set_updated_at
    before update on whatsapp_login_requests
    for each row execute function set_updated_at();
  end if;
end $$;

create index if not exists whatsapp_login_requests_project_phone_idx on whatsapp_login_requests(project_key, phone_e164);
create index if not exists whatsapp_login_requests_code_idx on whatsapp_login_requests(code);
create index if not exists whatsapp_login_requests_expires_idx on whatsapp_login_requests(expires_at);

create table if not exists whatsapp_register_requests (
  id bigserial primary key,
  project_key text not null references whatsapp_projects(project_key) on delete cascade,
  session_id text not null unique,
  phone_e164 varchar(20) not null,
  code varchar(10) not null,
  expires_at timestamptz not null,
  verified_at timestamptz null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_register_requests_set_updated_at') then
    create trigger whatsapp_register_requests_set_updated_at
    before update on whatsapp_register_requests
    for each row execute function set_updated_at();
  end if;
end $$;

create index if not exists whatsapp_register_requests_project_phone_idx on whatsapp_register_requests(project_key, phone_e164);
create index if not exists whatsapp_register_requests_code_idx on whatsapp_register_requests(code);
create index if not exists whatsapp_register_requests_expires_idx on whatsapp_register_requests(expires_at);

create table if not exists whatsapp_recovery_requests (
  id bigserial primary key,
  project_key text not null references whatsapp_projects(project_key) on delete cascade,
  session_id text not null unique,
  phone_e164 varchar(20) not null,
  code varchar(10) not null,
  expires_at timestamptz not null,
  verified_at timestamptz null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_recovery_requests_set_updated_at') then
    create trigger whatsapp_recovery_requests_set_updated_at
    before update on whatsapp_recovery_requests
    for each row execute function set_updated_at();
  end if;
end $$;

create index if not exists whatsapp_recovery_requests_project_phone_idx on whatsapp_recovery_requests(project_key, phone_e164);
create index if not exists whatsapp_recovery_requests_code_idx on whatsapp_recovery_requests(code);
create index if not exists whatsapp_recovery_requests_expires_idx on whatsapp_recovery_requests(expires_at);

create table if not exists whatsapp_incoming_messages (
  id bigserial primary key,
  wa_message_id text null,
  from_e164 varchar(20) null,
  body text null,
  extracted_code varchar(10) null,
  created_at timestamptz not null default now()
);

create index if not exists whatsapp_incoming_messages_from_idx on whatsapp_incoming_messages(from_e164, created_at desc);

create table if not exists whatsapp_bridge_sessions (
  id uuid primary key default gen_random_uuid(),
  project_key text not null references whatsapp_projects(project_key) on delete cascade,
  flow text not null,
  user_ref text null,
  correlation_id text null,
  phone_e164 varchar(20) not null,
  code varchar(10) not null,
  otp_ref varchar(20) not null,
  status text not null default 'pending',
  attempts int not null default 0,
  expires_at timestamptz not null,
  verified_at timestamptz null,
  callback_url text null,
  metadata jsonb null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (flow in ('verification', 'login', 'register', 'recovery')),
  check (status in ('pending', 'verified', 'expired', 'cancelled'))
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_bridge_sessions_set_updated_at') then
    create trigger whatsapp_bridge_sessions_set_updated_at
    before update on whatsapp_bridge_sessions
    for each row execute function set_updated_at();
  end if;
end $$;

create unique index if not exists whatsapp_bridge_sessions_project_ref_uq
  on whatsapp_bridge_sessions(project_key, otp_ref);
create index if not exists whatsapp_bridge_sessions_phone_status_idx
  on whatsapp_bridge_sessions(phone_e164, status, created_at desc);
create index if not exists whatsapp_bridge_sessions_project_status_expires_idx
  on whatsapp_bridge_sessions(project_key, status, expires_at);
create index if not exists whatsapp_bridge_sessions_code_idx
  on whatsapp_bridge_sessions(code);

create table if not exists whatsapp_bridge_events (
  id bigserial primary key,
  session_id uuid not null references whatsapp_bridge_sessions(id) on delete cascade,
  project_key text not null references whatsapp_projects(project_key) on delete cascade,
  event_type text not null,
  payload jsonb not null,
  delivery_status text not null default 'pending',
  delivery_attempts int not null default 0,
  next_retry_at timestamptz not null default now(),
  processing_started_at timestamptz null,
  delivered_at timestamptz null,
  last_error text null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (delivery_status in ('pending', 'processing', 'delivered', 'failed')),
  unique (session_id, event_type)
);

do $$
begin
  if not exists (select 1 from pg_trigger where tgname = 'whatsapp_bridge_events_set_updated_at') then
    create trigger whatsapp_bridge_events_set_updated_at
    before update on whatsapp_bridge_events
    for each row execute function set_updated_at();
  end if;
end $$;

create index if not exists whatsapp_bridge_events_status_retry_idx
  on whatsapp_bridge_events(delivery_status, next_retry_at);
create index if not exists whatsapp_bridge_events_project_status_retry_idx
  on whatsapp_bridge_events(project_key, delivery_status, next_retry_at);

-- Memoria de conversación del asistente multi-agente: historial de texto por
-- número de WhatsApp, con vencimiento (TTL) para olvidar charlas inactivas.
create table if not exists whatsapp_agent_messages (
  id bigserial primary key,
  project_key text not null,
  phone_e164 text not null,
  role text not null,
  content text not null,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null,
  check (role in ('user', 'assistant'))
);

create index if not exists whatsapp_agent_messages_lookup_idx
  on whatsapp_agent_messages(project_key, phone_e164, id);
create index if not exists whatsapp_agent_messages_expiry_idx
  on whatsapp_agent_messages(expires_at);

-- ───────────────────────────────────────────────────────────────────────────
-- Capa de servicios: vínculo teléfono↔cuenta de un servicio externo
-- (LP, LUXIPANEL, LuxiChat...). `service_id` es la clave del ServiceConnector
-- (src/lib/services/registry.ts); `account_id` es el id del servicio (p.ej. el
-- customerId de LP-LS). El número solo puede estar vinculado una vez por
-- servicio. NOTA: aplicar este DDL con el user de la app (no correr el schema
-- completo) por la deuda conocida de set_updated_at().
-- ───────────────────────────────────────────────────────────────────────────
create table if not exists whatsapp_account_links (
  id bigserial primary key,
  phone_e164 text not null,
  service_id text not null,
  account_id text not null,
  display_name text null,
  status text not null default 'active',
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  verified_at timestamptz null,
  unique (phone_e164, service_id),
  check (status in ('active', 'revoked'))
);

create index if not exists whatsapp_account_links_phone_idx
  on whatsapp_account_links(phone_e164);

-- OTP de un solo uso para confirmar el vínculo. Se entrega en el mismo chat de
-- WhatsApp (límite Cloud API: solo se puede escribir a quien inició la conversación).
create table if not exists whatsapp_link_otps (
  id bigserial primary key,
  phone_e164 text not null,
  service_id text not null,
  account_id text not null,
  code varchar(10) not null,
  display_name text null,
  metadata jsonb not null default '{}'::jsonb,
  expires_at timestamptz not null,
  verified_at timestamptz null,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  -- 'otp' = código que enviamos al chat (legacy); 'totp' = código 2FA de la app
  -- del usuario, verificado contra el servicio (no se guarda código).
  via text not null default 'otp'
);
-- Para instalaciones existentes:
alter table whatsapp_link_otps add column if not exists via text not null default 'otp';

create index if not exists whatsapp_link_otps_lookup_idx
  on whatsapp_link_otps(phone_e164, service_id);
create index if not exists whatsapp_link_otps_expiry_idx
  on whatsapp_link_otps(expires_at);

-- Sesiones a servidor en background abiertas desde WhatsApp (Fase 2). Se usa
-- para conducir el módulo asistente de LUXIPANEL, reanudar y para auditoría/cobro.
create table if not exists whatsapp_server_sessions (
  id bigserial primary key,
  phone_e164 text not null,
  service_id text not null,
  account_id text not null,
  lp_session_id text null,
  target_id text null,
  conversation_id text null,
  status text not null default 'active',
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  ended_at timestamptz null,
  check (status in ('active', 'ended'))
);

create index if not exists whatsapp_server_sessions_phone_idx
  on whatsapp_server_sessions(phone_e164, status);

-- Sesión 2FA del chat: prueba que el número está autenticado con 2FA. Vida
-- deslizante; a >1h de inactividad se borra (junto al chat y sesiones a
-- servidor) para obligar a re-autenticar. Una por teléfono.
create table if not exists whatsapp_auth_sessions (
  phone_e164 text primary key,
  service_id text not null,
  account_id text not null,
  method text not null default 'totp',
  authenticated_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  expires_at timestamptz not null
);

create index if not exists whatsapp_auth_sessions_expiry_idx
  on whatsapp_auth_sessions(last_activity_at);
