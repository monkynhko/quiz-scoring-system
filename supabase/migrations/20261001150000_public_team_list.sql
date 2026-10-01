-- Verejný zoznam prihlásených tímov (iba názvy potvrdených registrácií, bez osobných údajov)
create or replace function event_team_names(p_slug text)
returns table (team_name text)
language sql stable security definer set search_path = public as $$
  -- názov, ktorý vyzerá ako e-mail, nezverejníme
  select case when r.team_name ~ '@' then 'Tím (názov doplníme)' else r.team_name end from registrations r join events e on e.id = r.event_id
  where e.slug = p_slug and e.is_public and r.status = 'confirmed'
  order by r.created_at
$$;
revoke all on function event_team_names(text) from public, anon, authenticated;
grant execute on function event_team_names(text) to anon, authenticated;
