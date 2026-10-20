# Kvíz Factory – kvizfactory.sk

Web vedomostno-zábavného pub kvízu Kvíz Factory (SP Factory s.r.o.): registrácia tímov, vstup s QR lístkami,
odovzdávanie fotiek odpoveďových hárkov, AI vyhodnotenie, opravovanie, projektor s poradím, príspevky na FB/IG.
Komunikácia s používateľom (Peter, hlavný admin) po slovensky.

## Vetvy a priečinky
| Vetva | Priečinok | Čo |
|---|---|---|
| `main` | – | STARÝ web na GitHub Pages (monkynhko.github.io/quiz-scoring-system) – starý admin, starý leaderboard. Nemeniť bez súhlasu. |
| `v2` | `~/projects/quiz-scoring-system` | NOVÝ web (kvizfactory.sk) + Supabase. Session „kvíz/aplikácia“. **Iba táto session nasadzuje.** |
| `socialsKvizFactory` | `~/projects/quiz-scoring-system-socials` (git worktree) | Session „sociálne siete“. Do `v2` sa zlučuje až po dokončení a súhlase. |

## Architektúra
- **Web** `web/` – React + Vite + TypeScript. Nasadenie na **Cloudflare Pages**, projekt `kvizfactory` (doména kvizfactory.sk, www):
  ```bash
  cd web && npm run build && CLOUDFLARE_API_TOKEN=$(cat ~/.cloudflare-token) CLOUDFLARE_ACCOUNT_ID=48bc900901590bd9ce82fa625fdbce2c \
    npx wrangler pages deploy dist --project-name kvizfactory --branch main --commit-hash $(git rev-parse HEAD)
  ```
  Node cez nvm (`. ~/.nvm/nvm.sh`). `web/.env.local` = Supabase URL + anon kľúč (necommitovať). Build kopíruje starý leaderboard na `/vysledky/`.
- **Supabase** projekt `rpkipyfafkdndcaoedtq` (eu-central-2, bezplatný plán). Migrácie v `supabase/migrations/` sa spúšťajú ručne
  cez Management API (`loadtest/sb.py` → `sql()`), nie `supabase db push`. Vždy najprv skúška v `begin; … rollback;`.
  - Edge functions (`supabase/functions/`, deploy: `npx supabase functions deploy <name> --project-ref rpkipyfafkdndcaoedtq --use-api`):
    `send-registration-email` (Resend), `manage-staff` (organizátori), `grade-sheet` (Gemini, `--no-verify-jwt`, chránená GRADE_SECRET),
    `publish-social` (FB/IG), `evaluate-submission` (STARÁ, pre starý admin).
  - Úložisko: `answer-sheets` (súkromné, iba admin číta), `social` (verejné – obrázky príspevkov).
  - `pg_cron` job `retry-stuck-grading` (každú minútu), `pg_net` volá grade-sheet; nastavenia v `private.settings`.
  - Roly: `profiles.is_admin` / `role` ('admin' | 'door') / `is_owner` (iba petis.spano@gmail.com pridáva adminov). Registrácia účtov vypnutá.
- **Resend** – doména kvizfactory.sk (overená), odosielatelia registracia@ a prihlasenie@ (aj SMTP pre prihlasovacie odkazy).
- **Gemini** 2.5 Flash – predplatený kredit (prepay). ~0,6 centa za hárok (2 volania). Spotreba v `answer_submissions.ai_usage`.
- **Meta** – FB stránka Kvíz Factory (`379903592837700`), IG @kviz.factory (`17841407915586964`). Trvalý token stránky je iba
  v Supabase secrets (`META_PAGE_TOKEN`, `META_PAGE_ID`, `META_IG_USER_ID`). Aplikácia „Kviz Factory Web“ v režime Development.
- **Kľúče** (nikdy nevypisovať, necommitovať, neposielať): `~/.supabase-token` (pri 401 požiadať o nový), `~/.cloudflare-token`,
  `~/.resend-key`, `~/Kviz Factory/credentials.txt` (Meta App ID/secret).

## Stránky
`/` úvod · `/registracia/:slug` · `/listky/:token` (stránka tímu, zmena počtu, potvrdenie účasti) · `/vstupenky` (vo výstavbe) ·
`/podmienky` · `/ochrana-udajov` · `/admin` · `/vstup` (skenovanie QR, offline) · `/priprava` (kvíz z eventu, odpovede) ·
`/opravovanie` · `/odovzdat` (tímy fotia hárky) · `/projektor` · `/live` · `/vysledky/` (starý leaderboard).

## Dohodnuté pravidlá (dôležité)
1. **Ostré registrácie sú posvätné.** Pred každou zmenou databázy, ktorá sa ich môže dotknúť: záloha (`~/projects/kvizfactory-backups/`)
   a kontrola počtu + kontrolného súčtu pred aj po (`loadtest/sb.py` → `live_registrations()`).
2. **Nič neodchádza von bez Petrovho výslovného „áno“** – e-maily, príspevky na FB/IG, mazanie dát. **Nasadenie webu a push do `v2`: od 20. 10. 2026 hneď po každej hotovej zmene (Peter: „všetko čo spravíš hneď nasaď“).**
   Najprv ukázať presný obsah. (Aj podľa ~/CLAUDE.md.)
3. **Pred každým testom, ktorý stojí peniaze** (Gemini, platené API): odhad ceny a súhlas. Pozor aj na automatické opakovania.
4. **Počas kvízu sa nenasadzuje.** Najbližší kvíz: utorok 20. 10. 2026, 19:00, Káčečko (35 tímov kapacita).
5. Texty na webe vecné, nie „marketingovo trápne“. Pohyblivé neónové SVG ilustrácie v štýle loga (magenta #fa14c3, žltá #ffd23f,
   tehlová stena) sú vítané; vždy s `prefers-reduced-motion`.
6. Commity s autorom z `git log main` a riadkom `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.

## Testovanie
- Prehliadač: Python Playwright (`pip install --user --break-system-packages playwright`), Chromium potrebuje knižnice bez sudo:
  `apt-get download libnspr4 libnss3 libasound2t64 libatk1.0-0t64 libatk-bridge2.0-0t64 libcups2t64 libxkbcommon0 libxcomposite1
  libxdamage1 libxfixes3 libxrandr2 libgbm1 libpango-1.0-0 libcairo2 libatspi2.0-0t64 libxshmfence1 libdrm2 libavahi-common3
  libavahi-client3 libwayland-server0` → `dpkg -x` do priečinka → `LD_LIBRARY_PATH=…/usr/lib/x86_64-linux-gnu`.
- WSL si niekedy pamätá starý DNS – na živý web `--host-resolver-rules=MAP kvizfactory.sk 172.67.157.183`.
- Admin stránky sa headless testovať nedajú (prihlásenie e-mailovým odkazom) – testuje Peter.
- `loadtest/` – simulácia celého kvízu (40 tímov, spomalený internet, výpadky, AI, opravovatelia). Skrytý testový kvíz
  `ZÁŤAŽOVÝ TEST` (id `…c0de`, created_at 2000 → nie je vo výsledkoch). Ďalší testový kvíz: `TEST AI benchmark` (`…a001`).

## Stav k 7. 10. 2026 a úlohy do 20. 10.
- 28 potvrdených tímov (158 ľudí) na 20. 10. Tím „sasa.sedlarova@gmail.com“ – Peter čaká na skutočný názov (premenovať ✏️ v adminovi).
- Predaj vstupeniek čaká na firemný bankový účet (prepínač `events.shop_open`, IBAN v nastaveniach eventu).
- TODO (session kvíz): hárky na záťažový test (`loadtest/sheets/real/r{kolo}_{nn}.jpg` + správne odpovede → test 40 tímov × 2 kolá,
  ~0,50 € po súhlase) · nové QR kódy na stoly (staré vedú na nefunkčnú starú stránku na odovzdávanie) · skúška nanečisto
  `/opravovanie` · príprava kvízu 20. 10. v `/priprava` (sezóna „2026 Sep – Dec“) · nasadiť commit s poistkou na obnovenie stránky ·
  **vstup (`/vstup`) treba ešte prejsť s Petrom („so vstupom sa musíme celkovo ešte pohrať“) – pripomenúť**.

## Pravidlá pre session „sociálne siete“
- Pracuje iba vo vetve `socialsKvizFactory` (priečinok `~/projects/quiz-scoring-system-socials`). Nenasadzuje web, nemení `v2`.
- Existujúce tabuľky a funkcie nemení. Nové objekty v databáze/úložisku pomenúva s prefixom `social_`; zmeny databázy najprv navrhne.
- Každý príspevok na FB/IG ide von iba po Petrovom „áno“ k presnému obrázku a textu. Zverejňuje sa cez `publish-social`.
