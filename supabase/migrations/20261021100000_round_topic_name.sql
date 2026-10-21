-- vlastný názov témy (napr. „Vikingovia“) – kategória ostáva na štatistiky a ligu
alter table round_topics add column if not exists name text;
