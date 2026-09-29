-- Lístky (QR kódy) sa tímu zobrazia až po zaplatení.

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
    'tickets', case when r.payment_status = 'paid' then
                 coalesce((select jsonb_agg(jsonb_build_object('seat_no', t.seat_no, 'code', t.code,
                                                               'checked_in', t.checked_in_at is not null) order by t.seat_no)
                           from tickets t where t.registration_id = r.id), '[]'::jsonb)
               else '[]'::jsonb end)
  from registrations r join events e on e.id = r.event_id
  where r.manage_token = p_token
$$;
