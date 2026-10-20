-- Ručné body za tému – majú vždy prednosť pred AI (AI ich neprepíše). Prázdna hodnota = späť na AI.

create table if not exists manual_topic_scores (
  team_id        uuid not null references teams(id) on delete cascade,
  round_topic_id uuid not null references round_topics(id) on delete cascade,
  score          numeric not null check (score >= 0),
  set_by         uuid references auth.users(id),
  set_at         timestamptz not null default now(),
  primary key (team_id, round_topic_id)
);
alter table manual_topic_scores enable row level security;
create policy "Admins read manual_topic_scores" on manual_topic_scores for select using (is_admin());
-- zápis iba cez set_manual_topic_score()

-- súčty: ručné body > AI (aktívny hárok) ; tím bez hárku a bez ručných bodov nemá záznam
create or replace function recompute_team_round(p_team_id uuid, p_round_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_sub uuid; rt record; v_manual numeric; v_ai numeric; v_val numeric; v_total numeric := 0; v_any boolean := false;
begin
  select id into v_sub from answer_submissions
  where team_id = p_team_id and round_id = p_round_id and status in ('pending', 'reviewed')
  order by submitted_at desc limit 1;

  for rt in select id, topic_order from round_topics where round_id = p_round_id order by topic_order loop
    select score into v_manual from manual_topic_scores where team_id = p_team_id and round_topic_id = rt.id;
    v_ai := null;
    if v_sub is not null then
      select coalesce(sum(coalesce(e.final_points, e.points, 0)), 0) into v_ai
      from ai_evaluations e
      where e.submission_id = v_sub
        and e.question_number between (rt.topic_order - 1) * 5 + 1 and rt.topic_order * 5;
    end if;
    v_val := coalesce(v_manual, v_ai);
    if v_val is not null then
      insert into topic_scores (team_id, round_topic_id, score) values (p_team_id, rt.id, v_val)
      on conflict (team_id, round_topic_id) do update set score = excluded.score;
      v_total := v_total + v_val;
      v_any := true;
    else
      delete from topic_scores where team_id = p_team_id and round_topic_id = rt.id;
    end if;
  end loop;

  if v_any then
    update scores set score = v_total where team_id = p_team_id and round_id = p_round_id;
    if not found then insert into scores (team_id, round_id, score) values (p_team_id, p_round_id, v_total); end if;
  else
    delete from scores where team_id = p_team_id and round_id = p_round_id;
  end if;
end $$;
revoke all on function recompute_team_round(uuid, uuid) from public, anon, authenticated;

-- nastavenie / zrušenie ručných bodov (admin)
create or replace function set_manual_topic_score(p_team_id uuid, p_round_topic_id uuid, p_score numeric)
returns void
language plpgsql security definer set search_path = public as $$
declare v_round uuid; v_max numeric;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  select round_id, max_points into v_round, v_max from round_topics where id = p_round_topic_id;
  if v_round is null then raise exception 'not_found'; end if;
  if not exists (select 1 from teams t join rounds r on r.quiz_id = t.quiz_id where t.id = p_team_id and r.id = v_round) then
    raise exception 'bad_team';
  end if;
  if p_score is null then
    delete from manual_topic_scores where team_id = p_team_id and round_topic_id = p_round_topic_id;
  else
    if p_score < 0 or p_score > coalesce(v_max, 100) or (p_score * 2) <> floor(p_score * 2) then raise exception 'bad_score'; end if;
    insert into manual_topic_scores (team_id, round_topic_id, score, set_by) values (p_team_id, p_round_topic_id, p_score, auth.uid())
    on conflict (team_id, round_topic_id) do update set score = excluded.score, set_by = excluded.set_by, set_at = now();
  end if;
  perform recompute_team_round(p_team_id, v_round);
end $$;
revoke all on function set_manual_topic_score(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function set_manual_topic_score(uuid, uuid, numeric) to authenticated;

alter publication supabase_realtime add table manual_topic_scores;
