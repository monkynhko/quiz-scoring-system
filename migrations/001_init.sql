-- quizzes table
create table quizzes (
  id uuid primary key default gen_random_uuid(),
  title text not null,
  created_at timestamptz default now()
);

-- profiles (user role)
create table profiles (
  id uuid references auth.users on delete cascade,
  email text,
  is_admin boolean default false,
  primary key (id)
);

-- teams
create table teams (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade,
  name text not null
);

-- rounds
create table rounds (
  id uuid primary key default gen_random_uuid(),
  quiz_id uuid references quizzes(id) on delete cascade,
  name text not null,
  round_order int
);

-- scores
create table scores (
  id uuid primary key default gen_random_uuid(),
  team_id uuid references teams(id) on delete cascade,
  round_id uuid references rounds(id) on delete cascade,
  score numeric not null default 0
);

-- RLS: povoliť SELECT pre anon/public
alter table quizzes enable row level security;
alter table teams enable row level security;
alter table rounds enable row level security;
alter table scores enable row level security;
alter table profiles enable row level security;

-- SELECT pre všetkých (anon)
create policy "Public read quizzes" on quizzes for select using (true);
create policy "Public read teams" on teams for select using (true);
create policy "Public read rounds" on rounds for select using (true);
create policy "Public read scores" on scores for select using (true);

-- INSERT/UPDATE/DELETE len pre authenticated adminov
create policy "Admins can write quizzes" on quizzes
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
create policy "Admins can write teams" on teams
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
create policy "Admins can write rounds" on rounds
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );
create policy "Admins can write scores" on scores
  for all using (
    exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
  );

-- profiles: admin môže čítať/vkladať svoj profil
create policy "Self manage profile" on profiles
  for all using (auth.uid() = id);
