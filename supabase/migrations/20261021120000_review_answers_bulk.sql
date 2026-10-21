-- hromadné prehodnotenie: rovnaké body naraz pre viac odpovedí (napr. všetky „Red Bull Downhill“ pri otázke 3)
create or replace function review_answers_bulk(p_eval_ids uuid[], p_points numeric)
returns int language plpgsql security definer set search_path = public as $$
declare n int; r record;
begin
  if not is_admin() then raise exception 'forbidden'; end if;
  if p_points not in (0, 0.5, 1) then raise exception 'bad_points'; end if;
  update ai_evaluations set final_points = p_points, reviewed_by = auth.uid(), reviewed_at = now(),
                            claimed_by = null, claimed_at = null,
                            admin_override = (p_points is distinct from points),
                            admin_override_correct = (p_points > 0)
  where id = any(p_eval_ids);
  get diagnostics n = row_count;
  for r in select distinct s.team_id, s.round_id from ai_evaluations e join answer_submissions s on s.id = e.submission_id
           where e.id = any(p_eval_ids) loop
    perform recompute_team_round(r.team_id, r.round_id);
  end loop;
  return n;
end $$;
revoke all on function review_answers_bulk(uuid[], numeric) from public;
grant execute on function review_answers_bulk(uuid[], numeric) to authenticated;
