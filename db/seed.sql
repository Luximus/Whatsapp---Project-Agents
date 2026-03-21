insert into whatsapp_projects (project_key, display_name, is_active)
values
  ('luxichat', 'LuxiChat', true),
  ('navai', 'Navai', true)
on conflict (project_key) do update set
  display_name = excluded.display_name,
  is_active = excluded.is_active,
  updated_at = now();
