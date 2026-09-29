-- Zmena počtu členov tímu (admin) + evidencia zaplatenej sumy (doplatky)

alter table registrations add column if not exists paid_cents int not null default 0;
update registrations set paid_cents = amount_cents where payment_status = 'paid' and paid_cents = 0;

-- Zaplatené / nezaplatené podľa sumy (volá admin tlačidlami Prevod ✓ / Hotovosť ✓ / Zrušiť platbu)
create or replace function set_registration_paid(p_registration_id uuid, p_method text)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_method is null then
    update registrations set payment_status = 'unpaid', payment_method = null, paid_at = null, paid_cents = 0
    where id = p_registration_id;
  else
    update registrations set payment_status = 'paid', payment_method = p_method, paid_at = now(), paid_cents = amount_cents
    where id = p_registration_id;
  end if;
end $$;

-- Zmena veľkosti tímu: prepočíta sumu, pridá lístky / odstráni nepoužité lístky navyše.
-- Existujúce QR kódy zostávajú platné.
create or replace function change_team_size(p_registration_id uuid, p_team_size int)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype; v_used_extra int;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_team_size < 1 or p_team_size > 6 then raise exception 'invalid_team_size'; end if;
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into e from events where id = r.event_id;

  select count(*) into v_used_extra from tickets
  where registration_id = r.id and seat_no > p_team_size and checked_in_at is not null;
  if v_used_extra > 0 then raise exception 'tickets_already_used'; end if;

  update registrations x set
    team_size = p_team_size,
    amount_cents = p_team_size * e.price_per_person_cents,
    payment_status = case when x.paid_cents >= p_team_size * e.price_per_person_cents and x.paid_cents > 0 then 'paid' else 'unpaid' end
  where x.id = r.id;

  if r.status = 'confirmed' then
    delete from tickets where registration_id = r.id and seat_no > p_team_size;
    insert into tickets (registration_id, seat_no, code)
    select r.id, s, random_ticket_code() from generate_series(1, p_team_size) s
    on conflict (registration_id, seat_no) do nothing;
  end if;
end $$;

-- registration_by_token doplnené o paid_cents (doplatok)
create or replace function registration_by_token(p_token uuid)
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'team_name', r.team_name, 'team_size', r.team_size, 'status', r.status,
    'payment_status', r.payment_status, 'amount_cents', r.amount_cents, 'paid_cents', r.paid_cents,
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

revoke all on function set_registration_paid(uuid, text) from public, anon, authenticated;
revoke all on function change_team_size(uuid, int)       from public, anon, authenticated;
grant execute on function set_registration_paid(uuid, text) to authenticated;
grant execute on function change_team_size(uuid, int)       to authenticated;
