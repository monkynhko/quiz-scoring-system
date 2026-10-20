-- Vstup: platba po jednom človeku (7 € za osobu) – ľudia z tímu prichádzajú postupne
create or replace function door_pay_person(p_registration_id uuid, p_count int default 1)
returns void
language plpgsql security definer set search_path = public as $$
declare r registrations%rowtype; e events%rowtype; v_paid int;
begin
  if not is_staff() then raise exception 'forbidden'; end if;
  if p_count < 1 or p_count > 6 then raise exception 'bad_count'; end if;
  select * into r from registrations where id = p_registration_id for update;
  if not found then raise exception 'not_found'; end if;
  select * into e from events where id = r.event_id;
  v_paid := r.paid_cents + p_count * e.door_price_per_person_cents;
  update registrations set
    paid_cents = v_paid,
    payment_method = 'cash',
    paid_at = coalesce(paid_at, now()),
    payment_status = case when v_paid >= amount_cents then 'paid' else 'unpaid' end
  where id = r.id;
end $$;
revoke all on function door_pay_person(uuid, int) from public, anon, authenticated;
grant execute on function door_pay_person(uuid, int) to authenticated;
