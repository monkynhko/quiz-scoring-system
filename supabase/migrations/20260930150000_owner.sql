-- Hlavný admin (owner): iba on pridáva / odoberá adminov. Ostatní admini spravujú iba rolu Vstup.
alter table profiles add column if not exists is_owner boolean not null default false;
update profiles set is_owner = true where email = 'petis.spano@gmail.com';

-- profily mení iba edge function manage-staff (service role), nikto cez API
drop policy if exists "Admins manage profiles" on profiles;
create policy "Admins read profiles" on profiles for select using (is_admin());
