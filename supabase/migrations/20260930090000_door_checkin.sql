-- Vstup: check-in s časom skenovania (offline fronta) a tím pridaný na mieste

drop function if exists check_in_ticket(text);
create or replace function check_in_ticket(p_code text, p_at timestamptz default now())
returns jsonb
language plpgsql security definer set search_path = public as $$
declare t tickets%rowtype; r registrations%rowtype; already timestamptz;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
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

-- Tím, ktorý príde bez registrácie (ignoruje zatvorenú registráciu aj kapacitu)
create or replace function admin_add_team(p_event_id uuid, p_team_name text, p_team_size int, p_paid_cash boolean default true)
returns uuid
language plpgsql security definer set search_path = public as $$
declare e events%rowtype; v_id uuid; v_amount int;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  select * into e from events where id = p_event_id;
  if not found then raise exception 'event_not_found'; end if;
  if p_team_size < 1 or p_team_size > 6 then raise exception 'invalid_team_size'; end if;
  v_amount := p_team_size * e.price_per_person_cents;
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

revoke all on function check_in_ticket(text, timestamptz)          from public, anon, authenticated;
revoke all on function admin_add_team(uuid, text, int, boolean)    from public, anon, authenticated;
grant execute on function check_in_ticket(text, timestamptz)       to authenticated;
grant execute on function admin_add_team(uuid, text, int, boolean) to authenticated;
