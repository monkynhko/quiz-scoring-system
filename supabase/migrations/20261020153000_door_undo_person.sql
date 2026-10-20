-- Vstup: oprava posledného ťuknutia (−1 osoba: von z check-inu a 7 € späť)
create or replace function door_undo_person(p_registration_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype; v_ticket uuid; v_paid int;
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into e from events where id = r.event_id;
  select id into v_ticket from tickets where registration_id = r.id and checked_in_at is not null
  order by checked_in_at desc, seat_no desc limit 1;
  if v_ticket is not null then update tickets set checked_in_at = null, checked_in_by = null where id = v_ticket; end if;
  v_paid := greatest(r.paid_cents - e.door_price_per_person_cents, 0);
  update registrations set paid_cents = v_paid,
    payment_status = case when v_paid > 0 and v_paid >= amount_cents then 'paid' else 'unpaid' end,
    paid_at = case when v_paid = 0 then null else paid_at end
  where id = r.id;
end $$;
revoke all on function door_undo_person(uuid) from public, anon, authenticated;
grant execute on function door_undo_person(uuid) to authenticated;
