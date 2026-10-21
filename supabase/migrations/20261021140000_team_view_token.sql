-- tajný odkaz tímu na „Naše hárky“ (opravené hárky po zverejnení kola)
alter table teams add column if not exists view_token uuid not null default gen_random_uuid();
create unique index if not exists teams_view_token_key on teams (view_token);

-- odkaz dostane iba ten, kto hárok nahral (pozná id odovzdania)…
create or replace function team_token_for_submission(p_submission_id uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select t.view_token from answer_submissions s join teams t on t.id = s.team_id where s.id = p_submission_id
$$;
-- …a kapitán zo stránky svojich lístkov (posledný kvíz, v ktorom tím hral)
create or replace function team_token_for_registration(p_manage_token uuid)
returns uuid language sql stable security definer set search_path = public as $$
  select t.view_token from registrations r join teams t on t.id = r.team_id
  where r.manage_token = p_manage_token and r.status = 'confirmed'
$$;
revoke all on function team_token_for_submission(uuid) from public;
revoke all on function team_token_for_registration(uuid) from public;
grant execute on function team_token_for_submission(uuid) to anon, authenticated;
grant execute on function team_token_for_registration(uuid) to anon, authenticated;

-- view_token nesmie byť verejne čitateľný (tímy sa čítajú bez prihlásenia) → SELECT len na ostatné stĺpce
revoke select on teams from anon, authenticated;
grant select (id, quiz_id, name) on teams to anon, authenticated;
