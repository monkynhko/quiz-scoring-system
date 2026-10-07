"""Zmaže testový kvíz (tímy, kolá, odovzdania, hodnotenia – kaskádou). Fotky v úložisku ostanú (desiatky MB)."""
from sb import sql, q, TEST_QUIZ_ID, live_registrations

before = live_registrations()
sql(f"delete from quizzes where id = {q(TEST_QUIZ_ID)} and created_at < '2001-01-01'")
after = live_registrations()
print('testový kvíz zmazaný; ostré registrácie:', after)
assert before == after
