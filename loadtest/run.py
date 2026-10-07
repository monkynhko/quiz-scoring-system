"""Záťažový test celého kvízu: N tímov odovzdáva fotky hárkov cez skutočnú stránku /odovzdat
(spomalený internet, výpadky signálu, opakované odoslanie, oneskorenci), AI na serveri, 3 súbežní
opravovatelia (zámky v databáze) a diváci na /live. Na konci tabuľka s časmi a výsledkom.

Použitie:  python3 run.py --teams 40 --rounds 5            (pred tým setup_quiz.py a make_sheets.py)
           python3 run.py --teams 3 --rounds 1 --quick    (rýchly skúšobný beh)
"""
import argparse, asyncio, json, pathlib, random, statistics, time
from playwright.async_api import async_playwright
from sb import sql, q, TEST_QUIZ_ID, live_registrations

HERE = pathlib.Path(__file__).parent
SHEETS = HERE / 'sheets'
RESULTS = HERE / 'results'
ADMINS = None  # načíta sa z profiles (3 admini = 3 opravovatelia)


def log(*a):
    print(time.strftime('%H:%M:%S'), *a, flush=True)


def sheet_files(round_no: int) -> list[pathlib.Path]:
    """Prednostne tvoje odfotené hárky (sheets/real/r{kolo}_*.jpg), inak umelé."""
    real = sorted((SHEETS / 'real').glob(f'r{round_no}_*.jp*g'))
    return real or sorted((SHEETS / 'synthetic').glob(f'r{round_no}_*.jpg'))


async def throttle(page, kbps_down: int, kbps_up: int, latency: int):
    cdp = await page.context.new_cdp_session(page)
    await cdp.send('Network.enable')
    await cdp.send('Network.emulateNetworkConditions', {
        'offline': False, 'latency': latency,
        'downloadThroughput': kbps_down * 1024 / 8, 'uploadThroughput': kbps_up * 1024 / 8})
    return cdp


QUEUE_EMPTY = "JSON.parse(localStorage.getItem('submit:queue') || '[]').length === 0"


async def wait_sent(page):
    """Hotovo = fronta v mobile je prázdna a zobrazila sa správa o odovzdaní."""
    try:  # položka sa zaradila (pri rýchlom sieti môže prebehnúť skôr, než ju zachytíme)
        await page.wait_for_function(f"!({QUEUE_EMPTY})", timeout=3_000)
    except Exception:  # noqa: BLE001
        pass
    await page.wait_for_function(QUEUE_EMPTY, timeout=180_000, polling=250)
    await page.wait_for_selector('.success:has-text("odovzdaný")', timeout=10_000)


async def team_flow(browser, args, team: str, photo: pathlib.Path, role: str, delay: float, sem, stats: list):
    await asyncio.sleep(delay)
    async with sem:
        rec = {'team': team, 'role': role, 'ok': False, 'photo_kb': round(photo.stat().st_size / 1024)}
        ctx = await browser.new_context(viewport={'width': 390, 'height': 844}, is_mobile=True, has_touch=True,
                                        user_agent='Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 Mobile/15E148')
        page = await ctx.new_page()
        t0 = time.time()
        try:
            cdp = await throttle(page, args.kbps_down, args.kbps_up, args.latency)
            await page.goto(f'{args.base}/odovzdat', wait_until='domcontentloaded', timeout=60_000)
            if role == 'late':
                await page.wait_for_selector('text=zatvorené', timeout=30_000)
                rec.update(ok=True, note='zatvorené okno správne zobrazené')
                return
            await page.wait_for_selector('select', timeout=60_000)
            await page.select_option('select', label=team)
            await page.set_input_files('input[type=file]', str(photo))
            await page.wait_for_selector('.preview img', timeout=60_000)
            t_click = time.time()
            await page.click('text=Odoslať za tím')
            sent = asyncio.create_task(wait_sent(page))
            if role == 'offline':
                await asyncio.sleep(1.5)
                await cdp.send('Network.emulateNetworkConditions', {'offline': True, 'latency': 0, 'downloadThroughput': -1, 'uploadThroughput': -1})
                await page.context.set_offline(True)
                await asyncio.sleep(args.offline_seconds)
                await page.context.set_offline(False)
                await throttle(page, args.kbps_down, args.kbps_up, args.latency)
            await sent
            rec.update(ok=True, submit_s=round(time.time() - t_click, 1), total_s=round(time.time() - t0, 1))
            if role == 'resubmit':
                await asyncio.sleep(8)
                await page.set_input_files('input[type=file]', str(photo))
                await page.wait_for_selector('.preview img', timeout=60_000)
                t2 = time.time()
                await page.click('text=Odoslať za tím')
                await wait_sent(page)
                rec['resubmit_s'] = round(time.time() - t2, 1)
        except Exception as e:  # noqa: BLE001
            rec['error'] = str(e).splitlines()[0][:160]
            await page.screenshot(path=str(RESULTS / f'error_{team.replace(" ", "_")}.png'))
        finally:
            rec.setdefault('total_s', round(time.time() - t0, 1))
            stats.append(rec)
            await ctx.close()


async def viewers(browser, args, n: int, stop: asyncio.Event, seen: dict):
    pages = []
    for _ in range(n):
        ctx = await browser.new_context(viewport={'width': 390, 'height': 844})
        p = await ctx.new_page()
        await p.goto(f'{args.base}/live?kviz={TEST_QUIZ_ID}', wait_until='domcontentloaded')
        pages.append(p)
    while not stop.is_set():
        await asyncio.sleep(5)
        try:
            txt = await pages[0].inner_text('body')
            seen['last'] = txt[:200]
        except Exception:  # noqa: BLE001
            pass
    for p in pages:
        await p.context.close()


def sql_as(admin_id: str, query: str):
    claims = json.dumps({'sub': admin_id, 'role': 'authenticated'})
    return sql(f"begin; set local role authenticated; set local request.jwt.claims = {q(claims)}; {query}; commit;")


async def reviewer(admin_id: str, round_id: str, stop: asyncio.Event, claimed: list, deadline: float):
    """Simulovaný opravovateľ: vezme ďalšiu pochybnú odpoveď a prijme návrh AI."""
    while time.time() < deadline:
        try:
            r = await asyncio.to_thread(sql_as, admin_id, f"select claim_next_review({q(round_id)}) as item")
        except RuntimeError as e:
            log('reviewer chyba', str(e)[:120]); await asyncio.sleep(2); continue
        item = r[0]['item'] if r else None
        if not item:
            if stop.is_set():
                return
            await asyncio.sleep(3); continue
        claimed.append((admin_id, item['id']))
        await asyncio.sleep(random.uniform(1.0, 3.0))   # človek sa pozerá na výrez
        pts = item['points'] if item['points'] in (0, 0.5, 1) else 0
        await asyncio.to_thread(sql_as, admin_id, f"select review_answer({q(item['id'])}, {pts})")


def round_status(round_id: str):
    return sql(f"""select count(*) total,
        count(*) filter (where ai_status='completed') done,
        count(*) filter (where ai_status in ('pending','processing')) busy,
        count(*) filter (where ai_status='failed') failed,
        max(ai_attempts) max_attempts,
        max(ai_processed_at) last_ai, min(submitted_at) first_sub, max(submitted_at) last_sub,
        (select count(*) from answer_submissions x where x.round_id={q(round_id)} and x.status='replaced') replaced,
        (select count(*) from ai_evaluations e join answer_submissions s2 on s2.id=e.submission_id where s2.round_id={q(round_id)} and s2.status='pending' and e.needs_review and e.final_points is null) open_reviews,
        (select count(*) from ai_evaluations e join answer_submissions s2 on s2.id=e.submission_id where s2.round_id={q(round_id)} and s2.status='pending' and e.needs_review) flagged,
        (select string_agg(distinct left(ai_error,120), ' | ') from answer_submissions x where x.round_id={q(round_id)} and x.ai_error is not null) errors
        from answer_submissions where round_id={q(round_id)} and status='pending'""")[0]


async def run_round(browser, args, rno: int, round_id: str, teams: list[str], admins: list[str], report: list):
    files = sheet_files(rno)
    assert files, f'chýbajú hárky pre {rno}. kolo (sheets/real alebo sheets/synthetic)'
    rnd = random.Random(rno)
    roles = ['normal'] * len(teams)
    idx = list(range(len(teams))); rnd.shuffle(idx)
    for k, i in enumerate(idx):
        if k < args.offline: roles[i] = 'offline'
        elif k < args.offline + args.resubmit: roles[i] = 'resubmit'
    window = args.window
    sql(f"update quizzes set submit_open=true, submit_round_id={q(round_id)}, submit_closes_at=now()+interval '{window} seconds' where id={q(TEST_QUIZ_ID)}")
    log(f'== {rno}. kolo: okno otvorené na {window} s, {len(teams)} tímov (offline {args.offline}, znova {args.resubmit}, neskoro {args.late})')
    stats: list = []
    sem = asyncio.Semaphore(args.concurrency)
    t_open = time.time()
    tasks = [asyncio.create_task(team_flow(browser, args, t, files[i % len(files)], roles[i], rnd.uniform(0, args.spread), sem, stats))
             for i, t in enumerate(teams)]
    # opravovatelia bežia súbežne s odovzdávaním
    stop = asyncio.Event(); claimed: list = []
    revs = [asyncio.create_task(reviewer(a, round_id, stop, claimed, time.time() + window + 240)) for a in admins]
    await asyncio.gather(*tasks)
    t_all_sent = time.time()
    # oneskorenci: po zatvorení okna
    wait_close = max(0, window - (time.time() - t_open)) + 3
    await asyncio.sleep(wait_close)
    sql(f"update quizzes set submit_open=false where id={q(TEST_QUIZ_ID)}")
    late_stats: list = []
    await asyncio.gather(*[team_flow(browser, args, teams[i], files[0], 'late', 0, sem, late_stats) for i in range(args.late)])
    # čakáme na AI
    t_wait = time.time()
    st = round_status(round_id)
    while (st['busy'] or 0) > 0 and time.time() - t_wait < 300:
        await asyncio.sleep(5); st = round_status(round_id)
    stop.set()
    await asyncio.gather(*revs)
    st = round_status(round_id)
    sql(f"update rounds set published_at=now() where id={q(round_id)}")
    ok = [s for s in stats if s['ok']]
    sub = [s['submit_s'] for s in ok if 'submit_s' in s]
    ids = [c[1] for c in claimed]
    row = {
        'kolo': rno, 'tímy': len(teams), 'odovzdané_ok': len(ok), 'chyby': len(stats) - len(ok),
        'odoslanie_p50_s': round(statistics.median(sub), 1) if sub else None,
        'odoslanie_max_s': max(sub) if sub else None,
        'offline_max_s': max((s.get('submit_s', 0) for s in ok if s['role'] == 'offline'), default=None),
        'všetci_odovzdali_za_s': round(t_all_sent - t_open, 1),
        'ai_hotové': f"{st['done']}/{st['total']}", 'ai_zlyhalo': st['failed'], 'ai_max_pokusov': st['max_attempts'],
        'ai_posledný_po_odovzdaní_s': round((time.mktime(time.strptime(st['last_ai'][:19], '%Y-%m-%d %H:%M:%S')) - time.mktime(time.strptime(st['last_sub'][:19], '%Y-%m-%d %H:%M:%S'))), 1) if st['last_ai'] and st['last_sub'] else None,
        'nahradené_hárky': st['replaced'],
        'na_kontrolu': st['flagged'], 'skontrolované': len(ids), 'duplicitné_zámky': len(ids) - len(set(ids)),
        'neskorí_odmietnutí': sum(1 for s in late_stats if s['ok']),
        'chyby_ai': st['errors'],
        'chyby_tímov': [f"{s['team']}: {s.get('error')}" for s in stats if not s['ok']][:5],
    }
    report.append(row)
    log(json.dumps(row, ensure_ascii=False))


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument('--base', default='https://kvizfactory.sk')
    ap.add_argument('--teams', type=int, default=40)
    ap.add_argument('--rounds', type=int, default=5)
    ap.add_argument('--window', type=int, default=150, help='dĺžka okna na odovzdávanie (s)')
    ap.add_argument('--spread', type=float, default=60, help='tímy prichádzajú v priebehu N sekúnd')
    ap.add_argument('--concurrency', type=int, default=20, help='max. naraz otvorených „mobilov“ (RAM)')
    ap.add_argument('--kbps-down', type=int, default=1500)
    ap.add_argument('--kbps-up', type=int, default=750)
    ap.add_argument('--latency', type=int, default=300)
    ap.add_argument('--offline', type=int, default=5)
    ap.add_argument('--offline-seconds', type=int, default=20)
    ap.add_argument('--resubmit', type=int, default=2)
    ap.add_argument('--late', type=int, default=2)
    ap.add_argument('--viewers', type=int, default=20)
    ap.add_argument('--quick', action='store_true', help='malý skúšobný beh')
    args = ap.parse_args()
    if args.quick:
        args.window, args.spread, args.offline, args.resubmit, args.late, args.viewers = 60, 10, 1, 1, 1, 2
    RESULTS.mkdir(exist_ok=True)

    before = live_registrations()
    log('ostré registrácie pred testom:', before)
    teams = [r['name'] for r in sql(f"select name from teams where quiz_id={q(TEST_QUIZ_ID)} order by name")][:args.teams]
    rounds = sql(f"select id, round_order from rounds where quiz_id={q(TEST_QUIZ_ID)} order by round_order")[:args.rounds]
    admins = [r['id'] for r in sql("select id from profiles where is_admin order by email")][:3]
    assert teams and rounds, 'najprv spusti setup_quiz.py'
    report: list = []
    async with async_playwright() as pw:
        browser = await pw.chromium.launch(args=[f'--host-resolver-rules=MAP kvizfactory.sk 172.67.157.183'])
        stop_v = asyncio.Event(); seen: dict = {}
        vtask = asyncio.create_task(viewers(browser, args, args.viewers, stop_v, seen))
        for r in rounds:
            await run_round(browser, args, r['round_order'] + 1, r['id'], teams, admins, report)
        await asyncio.sleep(10)
        stop_v.set(); await vtask
        await browser.close()
    after = live_registrations()
    log('ostré registrácie po teste:  ', after)
    out = {'nastavenia': vars(args), 'kolá': report, 'projektor_naposledy': seen.get('last'),
           'ostré_registrácie_bez_zmeny': before == after}
    path = RESULTS / f"zataz_{time.strftime('%Y%m%d_%H%M')}.json"
    path.write_text(json.dumps(out, ensure_ascii=False, indent=1))
    log('výsledok:', path)
    print('\n| kolo | odovzdané | odoslanie p50 / max | offline max | AI hotové | AI posledný po odovzdaní | na kontrolu / skontrolované | duplicitné zámky | neskorí odmietnutí |')
    print('|---|---|---|---|---|---|---|---|---|')
    for r in report:
        print(f"| {r['kolo']} | {r['odovzdané_ok']}/{r['tímy']} | {r['odoslanie_p50_s']} s / {r['odoslanie_max_s']} s | {r['offline_max_s']} s | {r['ai_hotové']} (zlyhalo {r['ai_zlyhalo']}, pokusov max {r['ai_max_pokusov']}) | {r['ai_posledný_po_odovzdaní_s']} s | {r['na_kontrolu']} / {r['skontrolované']} | {r['duplicitné_zámky']} | {r['neskorí_odmietnutí']}/{args.late} |")
    print('\nOstré registrácie bez zmeny:', before == after)


if __name__ == '__main__':
    asyncio.run(main())
