-- Registrácia tímov + lístky (v2)
-- Existujúce tabuľky (quizzes, teams, rounds, scores, ...) sa nemenia.
-- Registrácia žije v samostatnej tabuľke events, aby starý leaderboard/admin
-- nevideli nový kvíz skôr, než sa v deň kvízu vytvorí v bodovaní (events.quiz_id).

create or replace function public.is_admin() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and p.is_admin)
$$;

-- 1. Večer kvízu (registrácia, kapacita, cena, platobné údaje)
create table if not exists events (
  id                     uuid primary key default gen_random_uuid(),
  slug                   text not null unique,              -- napr. 'vol-24'
  title                  text not null,                     -- 'Kvíz Factory vol. 24'
  starts_at              timestamptz not null,
  venue                  text not null,
  capacity_teams         int  not null default 35 check (capacity_teams > 0),
  price_per_person_cents int  not null default 700 check (price_per_person_cents >= 0),
  min_team_size          int  not null default 4,
  max_team_size          int  not null default 6,
  registration_open      boolean not null default false,    -- prepínač v administrácii
  registration_closes_at timestamptz,                        -- voliteľné automatické zatvorenie
  is_public              boolean not null default true,     -- testovacie eventy sa nezobrazujú na webe
  payment_iban           text,                               -- null = iba platba na mieste
  payment_beneficiary    text,
  teaser                 jsonb,                              -- {"question": "...", "options": ["..."], "correct": 0}
  quiz_id                uuid references quizzes(id) on delete set null,
  created_at             timestamptz not null default now()
);

-- 2. Registrácie
create table if not exists registrations (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references events(id) on delete cascade,
  team_name       text not null check (char_length(btrim(team_name)) between 1 and 60),
  email           text not null check (email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  team_size       int  not null check (team_size between 1 and 6),
  status          text not null default 'confirmed' check (status in ('confirmed', 'waitlist', 'cancelled')),
  payment_status  text not null default 'unpaid'    check (payment_status in ('unpaid', 'paid', 'refunded')),
  payment_method  text check (payment_method in ('transfer', 'card', 'cash')),
  amount_cents    int  not null,
  paid_at         timestamptz,
  variable_symbol text not null unique,
  manage_token    uuid not null unique default gen_random_uuid(),  -- tajný odkaz v emaili na lístky
  teaser_answer   int,
  consent_at      timestamptz not null default now(),
  email_sent_at   timestamptz,
  team_id         uuid references teams(id) on delete set null,     -- prepojenie na bodovanie v deň kvízu
  admin_note      text,
  created_at      timestamptz not null default now()
);
create unique index if not exists registrations_event_team_name_uq
  on registrations (event_id, lower(btrim(team_name))) where status <> 'cancelled';
create index if not exists registrations_event_idx on registrations (event_id, status);

-- 3. Lístky (1 lístok = 1 osoba)
create table if not exists tickets (
  id              uuid primary key default gen_random_uuid(),
  registration_id uuid not null references registrations(id) on delete cascade,
  seat_no         int  not null,
  code            text not null unique,  -- obsah QR kódu, náhodný, neuhádnuteľný
  checked_in_at   timestamptz,
  checked_in_by   uuid references auth.users(id),
  unique (registration_id, seat_no)
);

create sequence if not exists registration_vs_seq start 1;

create or replace function random_ticket_code() returns text
language sql volatile set search_path = public, extensions as $$
  select 'KF-' || upper(encode(gen_random_bytes(9), 'hex'))
$$;

-- 4. Verejné info o eventoch (bez osobných údajov)
create or replace function public_events()
returns table (id uuid, slug text, title text, starts_at timestamptz, venue text,
               capacity_teams int, taken int, price_per_person_cents int,
               min_team_size int, max_team_size int, registration_open boolean,
               has_transfer boolean, teaser_question text, teaser_options jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.starts_at, e.venue, e.capacity_teams,
         (select count(*)::int from registrations r where r.event_id = e.id and r.status = 'confirmed'),
         e.price_per_person_cents, e.min_team_size, e.max_team_size,
         e.registration_open and (e.registration_closes_at is null or now() < e.registration_closes_at),
         e.payment_iban is not null,
         e.teaser->>'question', e.teaser->'options'
  from events e
  where e.is_public and e.starts_at > now() - interval '12 hours'
  order by e.starts_at
$$;

-- Testovací event podľa slugu (neverejný, ale dostupný cez priamy odkaz)
create or replace function event_by_slug(p_slug text)
returns table (id uuid, slug text, title text, starts_at timestamptz, venue text,
               capacity_teams int, taken int, price_per_person_cents int,
               min_team_size int, max_team_size int, registration_open boolean,
               has_transfer boolean, teaser_question text, teaser_options jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.starts_at, e.venue, e.capacity_teams,
         (select count(*)::int from registrations r where r.event_id = e.id and r.status = 'confirmed'),
         e.price_per_person_cents, e.min_team_size, e.max_team_size,
         e.registration_open and (e.registration_closes_at is null or now() < e.registration_closes_at),
         e.payment_iban is not null,
         e.teaser->>'question', e.teaser->'options'
  from events e where e.slug = p_slug
$$;

-- 5. Registrácia tímu: atomicky skontroluje kapacitu, vytvorí registráciu a lístky
create or replace function register_team(
  p_event_id uuid, p_team_name text, p_email text, p_team_size int, p_teaser_answer int default null
) returns table (registration_id uuid, status text, manage_token uuid)
language plpgsql security definer set search_path = public as $$
declare
  e events%rowtype;
  v_taken int;
  v_status text;
  v_reg registrations%rowtype;
begin
  -- zámok na event, aby dvaja naraz nezabrali posledné miesto
  select * into e from events where id = p_event_id for update;
  if not found then raise exception 'event_not_found'; end if;
  if not e.registration_open or (e.registration_closes_at is not null and now() >= e.registration_closes_at) then
    raise exception 'registration_closed';
  end if;
  if p_team_size < e.min_team_size or p_team_size > e.max_team_size then
    raise exception 'invalid_team_size';
  end if;

  select count(*) into v_taken from registrations r where r.event_id = p_event_id and r.status = 'confirmed';
  v_status := case when v_taken < e.capacity_teams then 'confirmed' else 'waitlist' end;

  begin
    insert into registrations (event_id, team_name, email, team_size, status, amount_cents, variable_symbol, teaser_answer)
    values (p_event_id, btrim(p_team_name), lower(btrim(p_email)), p_team_size, v_status,
            p_team_size * e.price_per_person_cents,
            to_char(now(), 'YY') || lpad(nextval('registration_vs_seq')::text, 6, '0'),
            p_teaser_answer)
    returning * into v_reg;
  exception when unique_violation then
    raise exception 'team_name_taken';
  end;

  if v_status = 'confirmed' then
    insert into tickets (registration_id, seat_no, code)
    select v_reg.id, s, random_ticket_code() from generate_series(1, p_team_size) s;
  end if;

  return query select v_reg.id, v_reg.status, v_reg.manage_token;
end $$;

-- Presun z čakacej listiny medzi potvrdené (admin) – vygeneruje lístky
create or replace function confirm_registration(p_registration_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update registrations x set status = 'confirmed' where x.id = p_registration_id and x.status <> 'confirmed'
  returning * into r;
  if found then
    insert into tickets (registration_id, seat_no, code)
    select r.id, s, random_ticket_code() from generate_series(1, r.team_size) s
    on conflict (registration_id, seat_no) do nothing;
  end if;
end $$;

-- Lístky podľa tajného tokenu z emailu
create or replace function registration_by_token(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'team_name', r.team_name, 'team_size', r.team_size, 'status', r.status,
    'payment_status', r.payment_status, 'amount_cents', r.amount_cents,
    'variable_symbol', r.variable_symbol, 'created_at', r.created_at,
    'event', jsonb_build_object('title', e.title, 'starts_at', e.starts_at, 'venue', e.venue,
                                'payment_iban', e.payment_iban, 'payment_beneficiary', e.payment_beneficiary,
                                'teaser', e.teaser),
    'teaser_answer', r.teaser_answer,
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('seat_no', t.seat_no, 'code', t.code,
                                                             'checked_in', t.checked_in_at is not null) order by t.seat_no)
                         from tickets t where t.registration_id = r.id), '[]'::jsonb))
  from registrations r join events e on e.id = r.event_id
  where r.manage_token = p_token
$$;

-- Check-in pri vstupe (iba admin / obsluha)
create or replace function check_in_ticket(p_code text)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; r registrations%rowtype; already timestamptz;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  select * into t from tickets where code = p_code for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  select * into r from registrations where id = t.registration_id;
  already := t.checked_in_at;
  if already is null then
    update tickets set checked_in_at = now(), checked_in_by = auth.uid() where id = t.id;
  end if;
  return jsonb_build_object(
    'result', case when r.status = 'cancelled' then 'cancelled'
                   when already is null then 'ok' else 'already_used' end,
    'checked_in_at', coalesce(already, now()),
    'team_name', r.team_name, 'seat_no', t.seat_no, 'team_size', r.team_size,
    'payment_status', r.payment_status, 'amount_cents', r.amount_cents, 'registration_id', r.id);
end $$;

-- 6. RLS: osobné údaje iba pre adminov, verejnosť ide len cez funkcie vyššie
alter table events        enable row level security;
alter table registrations enable row level security;
alter table tickets       enable row level security;
create policy "Admins manage events"        on events        for all using (is_admin()) with check (is_admin());
create policy "Admins manage registrations" on registrations for all using (is_admin()) with check (is_admin());
create policy "Admins manage tickets"       on tickets       for all using (is_admin()) with check (is_admin());

-- Supabase dáva anon/authenticated EXECUTE cez default privileges, preto revoke aj pre ne
revoke all on function register_team(uuid, text, text, int, int) from public, anon, authenticated;
revoke all on function confirm_registration(uuid)                from public, anon, authenticated;
revoke all on function check_in_ticket(text)                     from public, anon, authenticated;
revoke all on function random_ticket_code()                      from public, anon, authenticated;
grant execute on function register_team(uuid, text, text, int, int) to anon, authenticated;
grant execute on function public_events()               to anon, authenticated;
grant execute on function event_by_slug(text)           to anon, authenticated;
grant execute on function registration_by_token(uuid)   to anon, authenticated;
grant execute on function confirm_registration(uuid)    to authenticated;
grant execute on function check_in_ticket(text)         to authenticated;

-- živé aktualizácie v administrácii
alter publication supabase_realtime add table registrations, tickets;
