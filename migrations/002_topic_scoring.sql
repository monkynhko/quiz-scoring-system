-- Migration: Add topic-based scoring tables
-- categories, round_topics, topic_scores

-- categories (pre-populated with 10 common quiz categories)
create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  name text unique not null,
  icon text,
  created_at timestamptz default now()
);

-- Pre-populate categories
insert into categories (name, icon) values
  ('Šport', '⚽'),
  ('Geografia', '🌍'),
  ('História', '📜'),
  ('Veda', '🔬'),
  ('Film & Seriály', '🎬'),
  ('Hudba', '🎵'),
  ('Literatúra', '📚'),
  ('Jedlo & Nápoje', '🍕'),
  ('Príroda', '🌿'),
  ('Pop kultúra', '🌟')
on conflict (name) do nothing;

-- round_topics: each round has 2 topic entries (topic_order 1 and 2)
create table if not exists round_topics (
  id uuid primary key default gen_random_uuid(),
  round_id uuid references rounds(id) on delete cascade,
  category_id uuid references categories(id) on delete set null,
  topic_order smallint not null default 1,
  max_points numeric not null default 5,
  custom_name text  -- for "Iná..." custom category names
);

-- topic_scores: score per team per round_topic
create table if not exists topic_scores (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  round_topic_id uuid references round_topics(id) on delete cascade,
  score numeric not null default 0,
  unique (team_id, round_topic_id)
);

-- Add season_id to quizzes if not already present
-- (may already exist from prior migration)
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'quizzes' and column_name = 'season_id'
  ) then
    alter table quizzes add column season_id uuid references seasons(id);
  end if;
end $$;

-- RLS policies for new tables
alter table categories enable row level security;
alter table round_topics enable row level security;
alter table topic_scores enable row level security;

-- Public read for all new tables
create policy "Public read categories" on categories for select using (true);
create policy "Public read round_topics" on round_topics for select using (true);
create policy "Public read topic_scores" on topic_scores for select using (true);

-- Admin write for new tables
create policy "Admins can write categories" on categories
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
create policy "Admins can write round_topics" on round_topics
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
create policy "Admins can write topic_scores" on topic_scores
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
