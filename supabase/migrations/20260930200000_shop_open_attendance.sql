-- 1. Predaj vstupeniek: platobné údaje sa zobrazujú iba keď je predaj spustený
alter table events add column if not exists shop_open boolean not null default false;

-- 2. Potvrdenie účasti (e-mail pred kvízom)
alter table registrations
  add column if not exists attendance text check (attendance in ('yes', 'no')),
  add column if not exists attendance_at timestamptz,
  add column if not exists reminder_sent_at timestamptz;

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
         e.change_deadline_hours, e.shop_open and e.payment_iban is not null,
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
         e.change_deadline_hours, e.shop_open and e.payment_iban is not null,
         e.teaser->>'question', e.teaser->'options'
  from events e where e.slug = p_slug
$$;

-- platobné údaje von iba pri spustenom predaji
create or replace function registration_by_token(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'team_name', r.team_name, 'team_size', r.team_size, 'status', r.status,
    'payment_status', r.payment_status, 'amount_cents', r.amount_cents, 'paid_cents', r.paid_cents,
    'variable_symbol', r.variable_symbol, 'created_at', r.created_at,
    'attendance', r.attendance,
    'event', jsonb_build_object('title', e.title, 'starts_at', e.starts_at, 'venue', e.venue,
                                'shop_open', e.shop_open,
                                'payment_iban', case when e.shop_open then e.payment_iban end,
                                'payment_beneficiary', case when e.shop_open then e.payment_beneficiary end,
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

-- odpoveď tímu na výzvu „Potvrďte účasť“ (Neprídeme = zruší registráciu a uvoľní miesto, aj po lehote)
create or replace function team_attendance(p_token uuid, p_answer text)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype;
begin
  if p_answer not in ('yes', 'no') then raise exception 'bad_answer'; end if;
  select * into r from registrations where manage_token = p_token for update;
  if not found or r.status = 'cancelled' then raise exception 'not_found'; end if;
  select * into e from events where id = r.event_id;
  if now() >= e.starts_at then raise exception 'event_started'; end if;
  update registrations set attendance = p_answer, attendance_at = now(),
    status = case when p_answer = 'no' then 'cancelled' else status end,
    admin_note = case when p_answer = 'no'
                      then concat_ws(' · ', admin_note, 'neprídu (odpoveď ' || to_char(now() at time zone 'Europe/Bratislava', 'DD.MM. HH24:MI') || ')')
                      else admin_note end
  where id = r.id;
end $$;

revoke all on function team_attendance(uuid, text) from public, anon, authenticated;
grant execute on function team_attendance(uuid, text) to anon, authenticated;
