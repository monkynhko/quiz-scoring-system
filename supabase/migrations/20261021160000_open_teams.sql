-- firemné / súkromné eventy bez registrácie: tím si pri prvom odovzdaní napíše názov sám
alter table quizzes add column if not exists allow_new_teams boolean not null default false;

create or replace function current_submit_window()
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'quiz_id', q.id, 'quiz_title', q.title, 'round_id', r.id, 'round_name', r.name, 'round_order', r.round_order,
    'closes_at', q.submit_closes_at, 'allow_new_teams', q.allow_new_teams,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by lower(t.name)) from teams t where t.quiz_id = q.id), '[]'::jsonb))
  from quizzes q join rounds r on r.id = q.submit_round_id
  where q.submit_open and q.submit_closes_at > now()
  order by q.created_at desc limit 1
$$;

create or replace function create_submit_team(p_quiz_id uuid, p_name text)
returns uuid language plpgsql security definer set search_path = public as $$
declare q quizzes%rowtype; v_name text := btrim(regexp_replace(coalesce(p_name, ''), '\s+', ' ', 'g')); v_id uuid;
begin
  select * into q from quizzes where id = p_quiz_id;
  if not found or not q.allow_new_teams or not q.submit_open or q.submit_closes_at + interval '2 minutes' < now() then
    raise exception 'submit_closed';
  end if;
  if length(v_name) < 2 or length(v_name) > 60 then raise exception 'bad_name'; end if;
  select id into v_id from teams where quiz_id = p_quiz_id and lower(name) = lower(v_name) limit 1;
  if v_id is not null then return v_id; end if;
  if (select count(*) from teams where quiz_id = p_quiz_id) >= 100 then raise exception 'too_many_teams'; end if;
  insert into teams (quiz_id, name) values (p_quiz_id, v_name) returning id into v_id;
  return v_id;
end $$;
revoke all on function create_submit_team(uuid, text) from public;
grant execute on function create_submit_team(uuid, text) to anon, authenticated;
