-- verejná obrazovka „kto už odovzdal“: iba názvy tímov + áno/nie (žiadne fotky ani body), počíta sa za posledné okno odovzdávania
create or replace function submit_progress(p_quiz_id uuid default null)
returns jsonb language sql stable security definer set search_path = public as $$
  with q as (
    select * from quizzes
    where (p_quiz_id is not null and id = p_quiz_id) or (p_quiz_id is null and created_at > '2001-01-01')
    order by created_at desc limit 1
  )
  select jsonb_build_object(
    'quiz_title', q.title, 'round_name', r.name,
    'open', (q.submit_open and q.submit_closes_at > now()), 'closes_at', q.submit_closes_at, 'now', now(),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('name', t.name,
        'sent', exists (select 1 from answer_submissions s where s.team_id = t.id and s.round_id = r.id and s.status in ('pending', 'reviewed')))
        order by lower(t.name)) from teams t where t.quiz_id = q.id), '[]'::jsonb))
  from q join rounds r on r.id = q.submit_round_id
$$;
revoke all on function submit_progress(uuid) from public;
grant execute on function submit_progress(uuid) to anon, authenticated;
