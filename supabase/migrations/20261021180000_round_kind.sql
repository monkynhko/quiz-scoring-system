-- typ kola: 'sheet' = odpoveďový hárok (AI), 'manual' = prestávkové / ručne bodované kolo
alter table rounds add column if not exists kind text not null default 'sheet';
do $$ begin
  alter table rounds add constraint rounds_kind_check check (kind in ('sheet', 'manual'));
exception when duplicate_object then null; end $$;
