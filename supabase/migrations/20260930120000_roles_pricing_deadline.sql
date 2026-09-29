-- Roly (admin / vstup), cena na mieste, samoobslužná zmena počtu členov do 48 h pred kvízom

-- 1. Roly -------------------------------------------------------------------
-- (bezpečnostná oprava profiles policies a disable_signup už boli aplikované 30.9.)
alter table profiles add column if not exists role text check (role in ('admin', 'door'));
update profiles set role = 'admin' where is_admin and role is null;

-- admin aj obsluha vstupu
create or replace function is_staff() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from profiles p where p.id = auth.uid() and (p.is_admin or p.role in ('admin', 'door')))
$$;

create policy "Staff read events" on events for select using (is_staff());

-- 2. Ceny a lehota na zmeny -------------------------------------------------
alter table events
  add column if not exists door_price_per_person_cents int not null default 800,
  add column if not exists change_deadline_hours int not null default 48;

drop function if exists public_events();
drop function if exists event_by_slug(text);

create or replace function public_events()
returns table (id uuid, slug text, title text, starts_at timestamptz, venue text,
               capacity_teams int, taken int, price_per_person_cents int, door_price_per_person_cents int,
               min_team_size int, max_team_size int, registration_open boolean, change_deadline_hours int,
               has_transfer boolean, teaser_question text, teaser_options jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.starts_at, e.venue, e.capacity_teams,
         (select count(*)::int from registrations r where r.event_id = e.id and r.status = 'confirmed'),
         e.price_per_person_cents, e.door_price_per_person_cents, e.min_team_size, e.max_team_size,
         e.registration_open and (e.registration_closes_at is null or now() < e.registration_closes_at),
         e.change_deadline_hours, e.payment_iban is not null,
         e.teaser->>'question', e.teaser->'options'
  from events e
  where e.is_public and e.starts_at > now() - interval '12 hours'
  order by e.starts_at
$$;

create or replace function event_by_slug(p_slug text)
returns table (id uuid, slug text, title text, starts_at timestamptz, venue text,
               capacity_teams int, taken int, price_per_person_cents int, door_price_per_person_cents int,
               min_team_size int, max_team_size int, registration_open boolean, change_deadline_hours int,
               has_transfer boolean, teaser_question text, teaser_options jsonb)
language sql stable security definer set search_path = public as $$
  select e.id, e.slug, e.title, e.starts_at, e.venue, e.capacity_teams,
         (select count(*)::int from registrations r where r.event_id = e.id and r.status = 'confirmed'),
         e.price_per_person_cents, e.door_price_per_person_cents, e.min_team_size, e.max_team_size,
         e.registration_open and (e.registration_closes_at is null or now() < e.registration_closes_at),
         e.change_deadline_hours, e.payment_iban is not null,
         e.teaser->>'question', e.teaser->'options'
  from events e where e.slug = p_slug
$$;

create or replace function registration_by_token(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'team_name', r.team_name, 'team_size', r.team_size, 'status', r.status,
    'payment_status', r.payment_status, 'amount_cents', r.amount_cents, 'paid_cents', r.paid_cents,
    'variable_symbol', r.variable_symbol, 'created_at', r.created_at,
    'event', jsonb_build_object('title', e.title, 'starts_at', e.starts_at, 'venue', e.venue,
                                'payment_iban', e.payment_iban, 'payment_beneficiary', e.payment_beneficiary,
                                'teaser', e.teaser,
                                'price_per_person_cents', e.price_per_person_cents,
                                'door_price_per_person_cents', e.door_price_per_person_cents,
                                'min_team_size', e.min_team_size, 'max_team_size', e.max_team_size,
                                'change_deadline', e.starts_at - make_interval(hours => e.change_deadline_hours)),
    'teaser_answer', r.teaser_answer,
    'tickets', case when r.payment_status = 'paid' then
                 coalesce((select jsonb_agg(jsonb_build_object('seat_no', t.seat_no, 'code', t.code,
                                                               'checked_in', t.checked_in_at is not null) order by t.seat_no)
                           from tickets t where t.registration_id = r.id), '[]'::jsonb)
               else '[]'::jsonb end)
  from registrations r join events e on e.id = r.event_id
  where r.manage_token = p_token
$$;

-- spoločná logika zmeny veľkosti (lístky + suma podľa online ceny)
create or replace function _apply_team_size(p_registration_id uuid, p_team_size int)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype; v_amount int;
begin
  select * into r from registrations where id = p_registration_id for update;
  select * into e from events where id = r.event_id;
  if exists (select 1 from tickets where registration_id = r.id and seat_no > p_team_size and checked_in_at is not null) then
    raise exception 'tickets_already_used';
  end if;
  v_amount := p_team_size * e.price_per_person_cents;
  update registrations x set
    team_size = p_team_size,
    amount_cents = v_amount,
    payment_status = case when x.paid_cents > 0 and x.paid_cents >= v_amount then 'paid' else 'unpaid' end
  where x.id = r.id;
  if r.status = 'confirmed' then
    delete from tickets where registration_id = r.id and seat_no > p_team_size;
    insert into tickets (registration_id, seat_no, code)
    select r.id, s, random_ticket_code() from generate_series(1, p_team_size) s
    on conflict (registration_id, seat_no) do nothing;
  end if;
end $$;
revoke all on function _apply_team_size(uuid, int) from public, anon, authenticated;

-- admin: bez obmedzení
create or replace function change_team_size(p_registration_id uuid, p_team_size int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_team_size < 1 or p_team_size > 6 then raise exception 'invalid_team_size'; end if;
  perform _apply_team_size(p_registration_id, p_team_size);
end $$;

-- tím cez svoj odkaz: zvýšiť kedykoľvek pred kvízom, znížiť / odhlásiť iba do lehoty (48 h)
create or replace function team_change_size(p_token uuid, p_team_size int)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype;
begin
  select * into r from registrations where manage_token = p_token;
  if not found or r.status = 'cancelled' then raise exception 'not_found'; end if;
  select * into e from events where id = r.event_id;
  if now() >= e.starts_at then raise exception 'event_started'; end if;
  if p_team_size < e.min_team_size or p_team_size > e.max_team_size then raise exception 'invalid_team_size'; end if;
  if p_team_size < r.team_size and now() >= e.starts_at - make_interval(hours => e.change_deadline_hours) then
    raise exception 'deadline_passed';
  end if;
  perform _apply_team_size(r.id, p_team_size);
end $$;

create or replace function team_cancel(p_token uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype;
begin
  select * into r from registrations where manage_token = p_token;
  if not found or r.status = 'cancelled' then raise exception 'not_found'; end if;
  select * into e from events where id = r.event_id;
  if now() >= e.starts_at - make_interval(hours => e.change_deadline_hours) then raise exception 'deadline_passed'; end if;
  update registrations set status = 'cancelled', admin_note = concat_ws(' · ', admin_note, 'odhlásili sa sami ' || to_char(now() at time zone 'Europe/Bratislava', 'DD.MM. HH24:MI'))
  where id = r.id;
end $$;

-- 3. Vstup (admin aj obsluha) ------------------------------------------------
-- dáta pre vstup bez e-mailov
create or replace function door_snapshot(p_event_id uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not is_staff() then null else coalesce(jsonb_agg(jsonb_build_object(
    'id', r.id, 'team_name', r.team_name, 'team_size', r.team_size, 'status', r.status,
    'payment_status', r.payment_status, 'amount_cents', r.amount_cents, 'paid_cents', r.paid_cents,
    'tickets', coalesce((select jsonb_agg(jsonb_build_object('code', t.code, 'seat_no', t.seat_no, 'checked_in_at', t.checked_in_at))
                         from tickets t where t.registration_id = r.id), '[]'::jsonb))), '[]'::jsonb) end
  from registrations r where r.event_id = p_event_id
$$;

-- platba pri vstupe: hotovosť = cena na mieste, prevod (ukázali potvrdenie) = online cena
create or replace function door_mark_paid(p_registration_id uuid, p_method text)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype; v_amount int;
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  if p_method not in ('cash', 'transfer') then raise exception 'bad_method'; end if;
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'not_found'; end if;
  if r.payment_status = 'paid' then return; end if;
  select * into e from events where id = r.event_id;
  v_amount := case when p_method = 'cash' then r.team_size * e.door_price_per_person_cents else r.amount_cents end;
  update registrations set amount_cents = v_amount, paid_cents = v_amount, payment_status = 'paid',
                           payment_method = p_method, paid_at = now()
  where id = r.id;
end $$;

create or replace function check_in_ticket(p_code text, p_at timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; r registrations%rowtype; already timestamptz;
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  select * into t from tickets where code = p_code for update;
  if not found then return jsonb_build_object('result', 'unknown'); end if;
  select * into r from registrations where id = t.registration_id;
  already := t.checked_in_at;
  if already is null and r.status = 'confirmed' then
    update tickets set checked_in_at = least(coalesce(p_at, now()), now()), checked_in_by = auth.uid() where id = t.id;
  end if;
  return jsonb_build_object(
    'result', case when r.status <> 'confirmed' then 'cancelled'
                   when already is null then 'ok' else 'already_used' end,
    'checked_in_at', coalesce(already, least(coalesce(p_at, now()), now())),
    'team_name', r.team_name, 'seat_no', t.seat_no, 'team_size', r.team_size,
    'payment_status', r.payment_status, 'amount_cents', r.amount_cents, 'registration_id', r.id);
end $$;

create or replace function admin_add_team(p_event_id uuid, p_team_name text, p_team_size int, p_paid_cash boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare e events%rowtype; v_id uuid; v_amount int;
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  select * into e from events where id = p_event_id;
  if not found then raise exception 'event_not_found'; end if;
  if p_team_size < 1 or p_team_size > 6 then raise exception 'invalid_team_size'; end if;
  v_amount := p_team_size * e.door_price_per_person_cents;
  begin
    insert into registrations (event_id, team_name, email, team_size, status, amount_cents, variable_symbol,
                               payment_status, payment_method, paid_at, paid_cents, admin_note, email_sent_at)
    values (p_event_id, btrim(p_team_name), 'na-mieste@kvizfactory.sk', p_team_size, 'confirmed', v_amount,
            to_char(now(), 'YY') || lpad(nextval('registration_vs_seq')::text, 6, '0'),
            case when p_paid_cash then 'paid' else 'unpaid' end,
            case when p_paid_cash then 'cash' end,
            case when p_paid_cash then now() end,
            case when p_paid_cash then v_amount else 0 end,
            'pridaný na mieste', now())
    returning id into v_id;
  exception when unique_violation then
    raise exception 'team_name_taken';
  end;
  insert into tickets (registration_id, seat_no, code)
  select v_id, s, random_ticket_code() from generate_series(1, p_team_size) s;
  return v_id;
end $$;

-- 4. Práva -------------------------------------------------------------------
revoke all on function is_staff()                        from public, anon;
revoke all on function door_snapshot(uuid)               from public, anon, authenticated;
revoke all on function door_mark_paid(uuid, text)        from public, anon, authenticated;
revoke all on function team_change_size(uuid, int)       from public, anon, authenticated;
revoke all on function team_cancel(uuid)                 from public, anon, authenticated;
revoke all on function change_team_size(uuid, int)       from public, anon, authenticated;
grant execute on function is_staff()                     to authenticated;
grant execute on function door_snapshot(uuid)            to authenticated;
grant execute on function door_mark_paid(uuid, text)     to authenticated;
grant execute on function change_team_size(uuid, int)    to authenticated;
grant execute on function team_change_size(uuid, int)    to anon, authenticated;
grant execute on function team_cancel(uuid)              to anon, authenticated;
grant execute on function public_events()                to anon, authenticated;
grant execute on function event_by_slug(text)            to anon, authenticated;
