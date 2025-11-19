# Supabase Quiz Scoring System — Setup & Security Guide

## 1. Vytvorenie Supabase projektu

- Zaregistruj sa na https://supabase.com a vytvor nový projekt.
- Vygeneruj `SUPABASE_URL` a `SUPABASE_ANON_KEY` (Project Settings → API).

## 2. Spusti SQL migráciu

- Otvor Supabase SQL editor.
- Skopíruj obsah `migrations/001_init.sql` a spusti.
- Over, že všetky tabuľky a policies vznikli.

## 3. Nastav RLS (Row Level Security)

- Skontroluj, že všetky policies sú aktívne (pozri SQL vyššie).
- SELECT je povolený pre všetkých (anon).
- INSERT/UPDATE/DELETE je povolený len pre authenticated používateľov s `is_admin = true` v profiles.

## 4. Pridaj admin profil

- Prihlás sa ako admin (magic link).
- V SQL editori vlož svoj profil:
  ```sql
  insert into profiles (id, email, is_admin) values ('<tvoje-user-id>', '<tvoj-email>', true);
  ```
  (user-id získaš z tabulky `auth.users`)

## 5. Nastav kľúče (bezpečne)

- Namiesto commitovania skutočných kľúčov do repozitára, používajte miestny `.env` súbor alebo environment variables v hostingu.
- Pridajte súbor `.env` (necommitovať) so zmennými:

```env
SUPABASE_URL=https://<project>.supabase.co
SUPABASE_ANON_KEY=<your_anon_key>
```

- Pre zdieľanie repozitára: nechajte v `app.js` a `leaderboard.html` placeholdery (napr. `<SUPABASE_ANON_KEY_PLACEHOLDER>`) alebo načítajte hodnoty pri build-e.
- Pred zverejnením repozitára: vždy skontrolujte, že `service_role` key nie je nikde v commitoch ani v súboroch.

## 6. Deployment na GitHub Pages

- Nahraj celý repozitár na GitHub.
- V Settings → Pages nastav root (main branch, /).
- Počkajte na deploy, leaderboard bude na https://<username>.github.io/<repo>/leaderboard.html

## 7. Bezpečnostné upozornenia

- **Nikdy** nevkladaj `service_role` key do klienta!
- `ANON_KEY` je bezpečný len ak RLS policies povoľujú len SELECT pre public.
- Admin actions (vkladanie, úpravy) sú povolené len pre authenticated používateľov s `is_admin = true`.
- Pre produkciu zváž ďalšie opatrenia: rate limiting, audit logy, monitoring.

## 8. Testovanie / Acceptance criteria

- Admin: prihlás sa, vytvor quiz, pridaj tímy a kolá, zadaj skóre, ulož — over v Supabase UI.
- Public: otvor leaderboard.html — zobrazuje najnovší quiz, žiadne inputy.
- Fallback: odpoj Supabase (zmeň key) — leaderboard.html zobrazí snapshot alebo chybu.

## 9. Príklady curl/JS

**Získať latest leaderboard (public):**
```js
const supabase = window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY);
const { data: quiz } = await supabase.from('quizzes').select('id').order('created_at', { ascending: false }).limit(1).single();
const { data: teams } = await supabase.from('teams').select('id, name').eq('quiz_id', quiz.id);
const { data: rounds } = await supabase.from('rounds').select('id, name').eq('quiz_id', quiz.id);
const { data: scores } = await supabase.from('scores').select('team_id, round_id, score');
```

**Admin vloží quiz cez JS:**
```js
await supabase.auth.signInWithOtp({ email: 'admin@domain.com' });
// Po prihlásení:
await supabase.from('quizzes').insert([{ title: 'Test Quiz' }]);
```

**curl GET leaderboard:**
```sh
curl "https://<project>.supabase.co/rest/v1/quizzes?select=*"
```
Supabase db pw:
Hunr260dtMIiV0ei