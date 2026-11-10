-- okno na odovzdávanie v sekundách (30 s, 1:30 min, +30 s …); pôvodná funkcia v minútach zostáva
create or replace function set_submit_window_seconds(p_quiz_id uuid, p_round_id uuid, p_seconds int)
returns void
language plpgsql security definer set search_path = public as $$
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_round_id is null or p_seconds <= 0 then
    update quizzes set submit_open = false where id = p_quiz_id;
  else
    update quizzes set submit_open = false where submit_open and id <> p_quiz_id;
    update quizzes set submit_open = true, submit_round_id = p_round_id,
                       submit_closes_at = now() + make_interval(secs => p_seconds)
    where id = p_quiz_id;
  end if;
end $$;
revoke all on function set_submit_window_seconds(uuid, uuid, int) from public, anon, authenticated;
grant execute on function set_submit_window_seconds(uuid, uuid, int) to authenticated;
