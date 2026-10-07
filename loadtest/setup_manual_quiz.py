"""Testovací kvíz pre ručné vyskúšanie (Peter): 10 skúšobných tímov, 5 kôl z answers.json.
Je skrytý (nie je vo výsledkoch ani na /live); na projektore: /projektor?kviz=<MANUAL_QUIZ_ID>.
Prepojí sa s neverejným eventom 'test', aby fungovala aj stránka /priprava."""
from sb import sql, q
from setup_quiz import build_quiz

MANUAL_QUIZ_ID = '00000000-0000-4000-8000-00000000be7e'
TEAMS = [f'Skúšobný tím {i}' for i in range(1, 11)]

if __name__ == '__main__':
    sql("update events set quiz_id = null where slug = 'test'")
    build_quiz(MANUAL_QUIZ_ID, 'TEST – skúška nanečisto', '2000-01-03', TEAMS, '0000000b')
    # prepojenie s neverejným eventom 'test' (trigger doplní tímy z jeho registrácií)
    sql(f"update events set quiz_id = {q(MANUAL_QUIZ_ID)} where slug = 'test'")
    for r in sql(f"select name from teams where quiz_id = {q(MANUAL_QUIZ_ID)} order by name"):
        print(' -', r['name'])
