-- Príspevky na FB/IG pri otvorení registrácie (náhľad → zverejnenie adminom)

-- verejné úložisko obrázkov príspevkov (Instagram ich sťahuje z verejnej URL)
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('social', 'social', true, 5242880, array['image/jpeg'])
on conflict (id) do nothing;
create policy "Admins upload social images" on storage.objects for insert to authenticated
  with check (bucket_id = 'social' and public.is_admin());

create table if not exists social_posts (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid references events(id) on delete set null,
  caption     text not null,
  image_path  text not null,
  fb_post_id  text,
  ig_media_id text,
  status      text not null default 'publishing' check (status in ('publishing', 'published', 'partial', 'failed')),
  error       text,
  created_by  uuid references auth.users(id),
  created_at  timestamptz not null default now()
);
alter table social_posts enable row level security;
create policy "Admins read social_posts" on social_posts for select using (is_admin());
-- zápis iba cez edge function publish-social (service role)
