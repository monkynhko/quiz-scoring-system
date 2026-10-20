-- skončený kvíz zmizne z úvodnej stránky ~4 h po začiatku (predtým 12 h)
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
  where e.is_public and e.starts_at > now() - interval '4 hours'
  order by e.starts_at
$$;
