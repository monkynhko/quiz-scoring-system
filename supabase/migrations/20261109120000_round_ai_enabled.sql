-- Kolo bez AI: hárky sa odovzdávajú (fotka) ako obvykle, ale AI ich nevyhodnocuje; body sa zadávajú ručne.
-- Predvolene AI zapnutá (správanie ostatných kôl sa nemení).

alter table rounds add column if not exists ai_enabled boolean not null default true;

alter table answer_submissions drop constraint if exists answer_submissions_ai_status_check;
alter table answer_submissions add constraint answer_submissions_ai_status_check
  check (ai_status in ('pending', 'processing', 'completed', 'failed', 'skipped'));

create or replace function private.dispatch_grading(p_submission_id uuid)
returns void
language plpgsql security definer set search_path = public, private as $$
declare v_url text; v_secret text;
begin
  -- kolo bez AI: nič nevolať, hárok iba označiť
  if exists (select 1 from answer_submissions s join rounds r on r.id = s.round_id
             where s.id = p_submission_id and not r.ai_enabled) then
    update answer_submissions set ai_status = 'skipped', ai_error = null where id = p_submission_id;
    return;
  end if;
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
