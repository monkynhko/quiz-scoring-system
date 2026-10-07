"""Pomocník: SQL cez Supabase Management API (token v ~/.supabase-token). Iba pre záťažový test."""
import json, pathlib, urllib.request

PROJECT = 'rpkipyfafkdndcaoedtq'
TOKEN = pathlib.Path.home().joinpath('.supabase-token').read_text().strip()
TEST_QUIZ_ID = '00000000-0000-4000-8000-00000000c0de'   # skrytý testový kvíz (created_at 2000 → nie je vo výsledkoch)
EVENT_SLUG = '2026-10-20'                                # ostrý event – iba na kontrolu, že sa nič nezmenilo


def sql(query: str):
    req = urllib.request.Request(
        f'https://api.supabase.com/v1/projects/{PROJECT}/database/query',
        data=json.dumps({'query': query}).encode(),
        headers={'Authorization': f'Bearer {TOKEN}', 'Content-Type': 'application/json'}, method='POST')
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return json.loads(r.read() or b'[]')
    except urllib.error.HTTPError as e:
        raise RuntimeError(e.read().decode()[:500]) from None


def q(s: str) -> str:
    """SQL literál"""
    return "'" + str(s).replace("'", "''") + "'"


def live_registrations():
    return sql(f"""select count(*) filter (where r.status='confirmed') teams, coalesce(sum(r.team_size) filter (where r.status='confirmed'),0) people,
                   count(*) total, md5(string_agg(r.id::text || r.status || r.team_name || r.team_size, '|' order by r.id)) checksum
                   from registrations r join events e on e.id = r.event_id where e.slug = {q(EVENT_SLUG)}""")[0]
