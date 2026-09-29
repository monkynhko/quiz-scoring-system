-- Tímy kvízu sa vytvárajú automaticky z potvrdených registrácií eventu (events.quiz_id).

create or replace function sync_event_teams(p_event_id uuid)
returns void
language plpgsql security definer set search_path = public as $$
declare v_quiz uuid; r record; v_team uuid;
begin
  select quiz_id into v_quiz from events where id = p_event_id;
  if v_quiz is null then return; end if;

  for r in select id, team_name, team_id, status from registrations where event_id = p_event_id loop
    if r.status = 'confirmed' then
      if r.team_id is null then
        insert into teams (quiz_id, name) values (v_quiz, r.team_name) returning id into v_team;
        update registrations set team_id = v_team where id = r.id;
      else
        update teams set name = r.team_name where id = r.team_id and name is distinct from r.team_name;
      end if;
    elsif r.team_id is not null
          and not exists (select 1 from answer_submissions s where s.team_id = r.team_id)
          and not exists (select 1 from scores sc where sc.team_id = r.team_id) then
      -- zrušená registrácia bez odovzdaných hárkov → tím z kvízu odstránime
      update registrations set team_id = null where id = r.id;
      delete from teams where id = r.team_id;
    end if;
  end loop;
end $$;

create or replace function on_registration_change()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if pg_trigger_depth() > 1 then return null; end if;   -- vlastné update-y zo sync_event_teams
  perform sync_event_teams(coalesce(new.event_id, old.event_id));
  return null;
end $$;
drop trigger if exists registrations_sync_teams on registrations;
create trigger registrations_sync_teams after insert or update of status, team_name on registrations
  for each row execute function on_registration_change();

create or replace function on_event_quiz_set()
returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.quiz_id is not null and new.quiz_id is distinct from old.quiz_id then
    update quizzes set event_id = new.id where id = new.quiz_id;
    perform sync_event_teams(new.id);
  end if;
  return new;
end $$;
drop trigger if exists events_quiz_set on events;
create trigger events_quiz_set after update of quiz_id on events
  for each row execute function on_event_quiz_set();

revoke all on function sync_event_teams(uuid) from public, anon, authenticated;
grant execute on function sync_event_teams(uuid) to authenticated;
