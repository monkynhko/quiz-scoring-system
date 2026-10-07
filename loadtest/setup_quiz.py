"""Vytvorí (alebo znova vytvorí) skrytý testový kvíz so N tímami a 5 kolami podľa answers.json.
Ostrých registrácií sa nedotkne – overí ich počet a kontrolný súčet pred aj po."""
import json, pathlib, sys
from sb import sql, q, TEST_QUIZ_ID, live_registrations


def build_quiz(quiz_id: str, title: str, created_at: str, team_names: list[str], id_prefix: str):
    """Skrytý kvíz (created_at 2000 → nie je vo výsledkoch ani na /live) s 5 kolami z answers.json."""
    before = live_registrations()
    print('ostré registrácie pred:', before)
    data = json.loads((pathlib.Path(__file__).parent / 'answers.json').read_text())['rounds']
    cats = {r['name']: r['id'] for r in sql('select id, name from categories')}
    stmts = [
        f"delete from quizzes where id = {q(quiz_id)} and created_at < '2001-01-01'",
        f"insert into quizzes (id, title, created_at, submit_open) values ({q(quiz_id)}, {q(title)}, {q(created_at)}, false)",
    ]
    for r, rd in enumerate(data):
        rid = f"00000000-0000-4000-8000-{id_prefix}0{r + 1:03d}"
        stmts.append(f"insert into rounds (id, quiz_id, name, round_order, published_at) values ({q(rid)}, {q(quiz_id)}, '{r + 1}', {r}, null)")
        for t in (1, 2):
            tid = f"00000000-0000-4000-8000-{id_prefix}1{r + 1}{t:02d}"
            cat = cats.get(rd['topics'][t - 1])
            stmts.append(f"insert into round_topics (id, round_id, category_id, topic_order, max_points) values ({q(tid)}, {q(rid)}, {q(cat) if cat else 'null'}, {t}, 5)")
            for n in range(1, 6):
                a = rd['answers'][(t - 1) * 5 + n - 1]
                alts = 'array[' + ','.join(q(x) for x in a.get('alternatives', [])) + ']::text[]' if a.get('alternatives') else 'null'
                note = q(a['note']) if a.get('note') else 'null'
                stmts.append(f"insert into correct_answers (round_topic_id, question_number, correct_answer, accept_alternatives, ai_note) values ({q(tid)}, {n}, {q(a['correct'])}, {alts}, {note})")
    for name in team_names:
        stmts.append(f"insert into teams (quiz_id, name) values ({q(quiz_id)}, {q(name)})")
    sql('begin;\n' + ';\n'.join(stmts) + ';\ncommit;')
    print(sql(f"select (select count(*) from teams where quiz_id={q(quiz_id)}) teams, (select count(*) from rounds where quiz_id={q(quiz_id)}) rounds, "
              f"(select count(*) from correct_answers ca join round_topics rt on rt.id=ca.round_topic_id join rounds r on r.id=rt.round_id where r.quiz_id={q(quiz_id)}) answers")[0])
    after = live_registrations()
    print('ostré registrácie po: ', after)
    assert before == after, 'POZOR: ostré registrácie sa zmenili!'


def main(n_teams: int = 40):
    build_quiz(TEST_QUIZ_ID, 'ZÁŤAŽOVÝ TEST', '2000-01-02', [f'Test tím {i:02d}' for i in range(1, n_teams + 1)], '0000000c')


if __name__ == '__main__':
    main(int(sys.argv[1]) if len(sys.argv) > 1 else 40)
