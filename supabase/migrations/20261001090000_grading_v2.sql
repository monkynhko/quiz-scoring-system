-- Opravovanie v2: fotka hárku → AI na serveri (paralelne) → kontrola iba pochybných odpovedí → zverejnenie kola
-- Nadväzuje na existujúce tabuľky (quizzes, rounds, round_topics, topic_scores, scores, answer_submissions, ai_evaluations).

create extension if not exists pg_net;
create extension if not exists pg_cron;

-- 1. Zverejnenie kôl --------------------------------------------------------
alter table rounds add column if not exists published_at timestamptz;
update rounds set published_at = coalesce(published_at, now());   -- história ostáva viditeľná

-- verejne iba zverejnené kolá (projektor, leaderboard); admini vidia všetko cez svoje policies
drop policy if exists "Public read scores" on scores;
create policy "Public read published scores" on scores for select
  using (exists (select 1 from rounds r where r.id = scores.round_id and r.published_at is not null));
drop policy if exists "Public read topic_scores" on topic_scores;
create policy "Public read published topic_scores" on topic_scores for select
  using (exists (select 1 from round_topics rt join rounds r on r.id = rt.round_id
                 where rt.id = topic_scores.round_topic_id and r.published_at is not null));

-- 2. Prepojenie kvízu s eventom (registrácie → tímy) -------------------------
alter table quizzes add column if not exists event_id uuid references events(id) on delete set null;

-- 3. Správne odpovede: pokyn pre AI (napr. „interpret + pieseň, za každé ½ bodu“)
alter table correct_answers add column if not exists ai_note text;

-- 4. Odovzdania a hodnotenia ---------------------------------------------------
alter table answer_submissions drop constraint if exists answer_submissions_status_check;
alter table answer_submissions add constraint answer_submissions_status_check
  check (status in ('pending', 'reviewed', 'rejected', 'replaced'));
alter table answer_submissions
  add column if not exists ai_attempts int not null default 0,
  add column if not exists ai_started_at timestamptz;

alter table ai_evaluations
  add column if not exists points numeric,          -- návrh AI: 0 / 0.5 / 1
  add column if not exists final_points numeric,    -- rozhodnutie opravovateľa (null = platí návrh AI)
  add column if not exists needs_review boolean not null default false,
  add column if not exists review_reason text,
  add column if not exists box jsonb,               -- [ymin, xmin, ymax, xmax] 0–1000, riadok odpovede na fotke
  add column if not exists claimed_by uuid references auth.users(id),
  add column if not exists claimed_at timestamptz,
  add column if not exists reviewed_by uuid references auth.users(id),
  add column if not exists reviewed_at timestamptz;

-- 5. Súčty: body témy = otázky 1–5 (téma 1), 6–10 (téma 2) z aktívneho hárku ----
create or replace function recompute_team_round(p_team_id uuid, p_round_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_sub uuid; rt record; v_sum numeric; v_total numeric := 0;
begin
  select id into v_sub from answer_submissions
  where team_id = p_team_id and round_id = p_round_id and status in ('pending', 'reviewed')
  order by submitted_at desc limit 1;

  for rt in select id, topic_order from round_topics where round_id = p_round_id order by topic_order loop
    select coalesce(sum(coalesce(e.final_points, e.points, 0)), 0) into v_sum
    from ai_evaluations e
    where e.submission_id = v_sub
      and e.question_number between (rt.topic_order - 1) * 5 + 1 and rt.topic_order * 5;
    if v_sub is not null then
      insert into topic_scores (team_id, round_topic_id, score) values (p_team_id, rt.id, v_sum)
      on conflict (team_id, round_topic_id) do update set score = excluded.score;
      v_total := v_total + v_sum;
    end if;
  end loop;

  if v_sub is not null then
    update scores set score = v_total where team_id = p_team_id and round_id = p_round_id;
    if not found then insert into scores (team_id, round_id, score) values (p_team_id, p_round_id, v_total); end if;
  end if;
end $$;
revoke all on function recompute_team_round(uuid, uuid) from public, anon, authenticated;

-- 6. Spustenie AI z databázy (pg_net → edge function grade-sheet) -------------
create schema if not exists private;
revoke all on schema private from public, anon, authenticated;
create table if not exists private.settings (key text primary key, value text not null);
-- hodnoty (functions_url, grade_secret) sa vkladajú mimo migrácie

create or replace function private.dispatch_grading(p_submission_id uuid)
returns void
language plpgsql security definer set search_path = public, private as $$
declare v_url text; v_secret text;
begin
  select value into v_url from private.settings where key = 'functions_url';
  select value into v_secret from private.settings where key = 'grade_secret';
  if v_url is null or v_secret is null then return; end if;
  update answer_submissions set ai_status = 'processing', ai_started_at = now(), ai_attempts = ai_attempts + 1, ai_error = null
  where id = p_submission_id;
  perform net.http_post(
    url := v_url || '/grade-sheet',
    headers := jsonb_build_object('Content-Type', 'application/json', 'x-grade-secret', v_secret),
    body := jsonb_build_object('submission_id', p_submission_id),
    timeout_milliseconds := 60000);
end $$;

create or replace function private.on_submission_insert()
returns trigger
language plpgsql security definer set search_path = public, private as $$
begin
  if new.ai_status = 'pending' then perform private.dispatch_grading(new.id); end if;
  return new;
end $$;
drop trigger if exists grade_on_insert on answer_submissions;
create trigger grade_on_insert after insert on answer_submissions
  for each row execute function private.on_submission_insert();

-- záchranná sieť: čo sa zaseklo alebo zlyhalo, skúsi sa znova (max. 4 pokusy)
create or replace function private.retry_stuck_grading()
returns void
language plpgsql security definer set search_path = public, private as $$
declare s record;
begin
  for s in select id from answer_submissions
           where status = 'pending' and ai_attempts < 4
             and ((ai_status = 'processing' and ai_started_at < now() - interval '75 seconds')
                  or (ai_status in ('pending', 'failed') and coalesce(ai_started_at, submitted_at) < now() - interval '30 seconds'))
             and submitted_at > now() - interval '12 hours'
  loop
    perform private.dispatch_grading(s.id);
  end loop;
end $$;
select cron.unschedule('retry-stuck-grading') where exists (select 1 from cron.job where jobname = 'retry-stuck-grading');
select cron.schedule('retry-stuck-grading', '* * * * *', 'select private.retry_stuck_grading()');

-- 7. Odovzdanie hárku (tím, verejne) ---------------------------------------------
-- aktuálne otvorené okno na odovzdávanie + tímy
create or replace function current_submit_window()
returns jsonb
language sql stable security definer set search_path = public as $$
  select jsonb_build_object(
    'quiz_id', q.id, 'quiz_title', q.title, 'round_id', r.id, 'round_name', r.name, 'round_order', r.round_order,
    'closes_at', q.submit_closes_at,
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name) order by lower(t.name)) from teams t where t.quiz_id = q.id), '[]'::jsonb))
  from quizzes q join rounds r on r.id = q.submit_round_id
  where q.submit_open and q.submit_closes_at > now()
  order by q.created_at desc limit 1
$$;

create or replace function submit_sheet(p_quiz_id uuid, p_team_id uuid, p_round_id uuid, p_photo_path text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare q quizzes%rowtype; v_id uuid;
begin
  select * into q from quizzes where id = p_quiz_id;
  -- 2 minúty tolerancia po zatvorení (fotka sa mohla nahrávať pri zlom signáli)
  if not found or q.submit_round_id is distinct from p_round_id or not q.submit_open
     or q.submit_closes_at + interval '2 minutes' < now() then
    raise exception 'submit_closed';
  end if;
  if not exists (select 1 from teams where id = p_team_id and quiz_id = p_quiz_id) then raise exception 'bad_team'; end if;
  if p_photo_path !~ ('^' || p_quiz_id::text || '/' || p_round_id::text || '/') then raise exception 'bad_path'; end if;

  update answer_submissions set status = 'replaced'
  where team_id = p_team_id and round_id = p_round_id and status in ('pending', 'reviewed');

  insert into answer_submissions (quiz_id, team_id, round_id, photo_path, photo_url, status, ai_status, submitted_by)
  values (p_quiz_id, p_team_id, p_round_id, p_photo_path, p_photo_path, 'pending', 'pending', 'web-v2')
  returning id into v_id;
  return v_id;
end $$;

-- 8. Opravovanie (admin) ------------------------------------------------------------
-- ďalšia pochybná odpoveď pre tohto opravovateľa (zámok na 90 s, aby ju nedostali dvaja)
create or replace function claim_next_review(p_round_id uuid)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare e ai_evaluations%rowtype; v jsonb;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  -- uvoľni moje predchádzajúce zámky
  update ai_evaluations set claimed_by = null, claimed_at = null
  where claimed_by = auth.uid() and final_points is null;

  select ev.* into e
  from ai_evaluations ev join answer_submissions s on s.id = ev.submission_id
  where s.round_id = p_round_id and s.status = 'pending' and s.ai_status = 'completed'
    and ev.needs_review and ev.final_points is null
    and (ev.claimed_by is null or ev.claimed_at < now() - interval '90 seconds')
  order by s.submitted_at, ev.question_number
  limit 1
  for update of ev skip locked;
  if not found then return null; end if;

  update ai_evaluations set claimed_by = auth.uid(), claimed_at = now() where id = e.id;

  select jsonb_build_object(
    'id', e.id, 'question_number', e.question_number, 'ocr_text', e.ocr_text, 'correct_answer', e.correct_answer,
    'points', e.points, 'confidence', e.confidence, 'reasoning', e.reasoning, 'review_reason', e.review_reason, 'box', e.box,
    'team_name', t.name, 'photo_path', s.photo_path, 'submission_id', s.id,
    'topic', (select c.name from round_topics rt left join categories c on c.id = rt.category_id
              where rt.round_id = s.round_id and rt.topic_order = case when e.question_number <= 5 then 1 else 2 end),
    'ai_note', (select ca.ai_note from round_topics rt join correct_answers ca on ca.round_topic_id = rt.id
                where rt.round_id = s.round_id and rt.topic_order = case when e.question_number <= 5 then 1 else 2 end
                  and ca.question_number = ((e.question_number - 1) % 5) + 1))
  into v
  from answer_submissions s join teams t on t.id = s.team_id where s.id = e.submission_id;
  return v;
end $$;

-- rozhodnutie o odpovedi (aj úprava hociktorej odpovede z detailu hárku)
create or replace function review_answer(p_eval_id uuid, p_points numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare s answer_submissions%rowtype;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_points not in (0, 0.5, 1) then raise exception 'bad_points'; end if;
  update ai_evaluations set final_points = p_points, reviewed_by = auth.uid(), reviewed_at = now(),
                            claimed_by = null, claimed_at = null,
                            admin_override = (p_points is distinct from points),
                            admin_override_correct = (p_points > 0)
  where id = p_eval_id;
  select * into s from answer_submissions where id = (select submission_id from ai_evaluations where id = p_eval_id);
  perform recompute_team_round(s.team_id, s.round_id);
end $$;

create or replace function publish_round(p_round_id uuid, p_publish boolean)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  update rounds set published_at = case when p_publish then now() end where id = p_round_id;
end $$;

-- okno na odovzdávanie (admin)
create or replace function set_submit_window(p_quiz_id uuid, p_round_id uuid, p_minutes int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_round_id is null or p_minutes <= 0 then
    update quizzes set submit_open = false where id = p_quiz_id;
  else
    update quizzes set submit_open = true, submit_round_id = p_round_id,
                       submit_closes_at = now() + make_interval(mins => p_minutes)
    where id = p_quiz_id;
  end if;
end $$;

-- 9. Bezpečnosť: hárky a hodnotenia iba pre adminov ------------------------------
drop policy if exists "Everyone can read answer_submissions" on answer_submissions;
do $$ declare p record; begin
  for p in select policyname from pg_policies where tablename = 'answer_submissions' and cmd in ('SELECT', 'INSERT') loop
    execute format('drop policy %I on answer_submissions', p.policyname);
  end loop;
end $$;
create policy "Admins read answer_submissions" on answer_submissions for select using (is_admin());
-- vkladanie iba cez submit_sheet()

-- fotky: nahrať môže ktokoľvek (tím), čítať iba admin
do $$ declare p record; begin
  for p in select policyname from pg_policies where schemaname = 'storage' and tablename = 'objects'
             and (qual like '%answer-sheets%' or with_check like '%answer-sheets%') loop
    execute format('drop policy %I on storage.objects', p.policyname);
  end loop;
end $$;
create policy "Teams upload answer sheets" on storage.objects for insert to anon, authenticated
  with check (bucket_id = 'answer-sheets');
create policy "Admins read answer sheets" on storage.objects for select to authenticated
  using (bucket_id = 'answer-sheets' and public.is_admin());

-- 10. Práva ----------------------------------------------------------------------
revoke all on function current_submit_window()                     from public, anon, authenticated;
revoke all on function submit_sheet(uuid, uuid, uuid, text)         from public, anon, authenticated;
revoke all on function claim_next_review(uuid)                      from public, anon, authenticated;
revoke all on function review_answer(uuid, numeric)                 from public, anon, authenticated;
revoke all on function publish_round(uuid, boolean)                 from public, anon, authenticated;
revoke all on function set_submit_window(uuid, uuid, int)           from public, anon, authenticated;
grant execute on function current_submit_window()                   to anon, authenticated;
grant execute on function submit_sheet(uuid, uuid, uuid, text)       to anon, authenticated;
grant execute on function claim_next_review(uuid)                    to authenticated;
grant execute on function review_answer(uuid, numeric)               to authenticated;
grant execute on function publish_round(uuid, boolean)               to authenticated;
grant execute on function set_submit_window(uuid, uuid, int)         to authenticated;

alter publication supabase_realtime add table answer_submissions, ai_evaluations, rounds;
