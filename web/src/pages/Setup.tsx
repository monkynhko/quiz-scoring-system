import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dateLong, time } from '../lib/format'
import { Spinner } from '../components'
import { AdminGate } from '../AdminGate'

// Príprava kvízu: prepojenie s eventom (tímy z registrácií), sezóna, kolá, témy a správne odpovede.
// Každé pole sa ukladá samostatne hneď po úprave – žiadne veľké „Uložiť“.

type EventRow = { id: string; title: string; starts_at: string; quiz_id: string | null; is_public: boolean }
type Season = { id: string; name: string; is_active: boolean }
type Category = { id: string; name: string }
type Answer = { id?: string; question_number: number; correct_answer: string; accept_alternatives: string[] | null; ai_note: string | null }
type Topic = { id: string; topic_order: number; category_id: string | null; name: string | null; max_points: number | null; correct_answers: Answer[] }
type Round = { id: string; name: string; round_order: number; kind: 'sheet' | 'manual'; round_topics: Topic[] }

export default function Setup() {
  return <AdminGate>{() => <SetupScreen />}</AdminGate>
}

function SetupScreen() {
  const [events, setEvents] = useState<EventRow[]>()
  const [eventId, setEventId] = useState<string>()
  const load = useCallback(async () => {
    const { data } = await supabase.from('events').select('id, title, starts_at, quiz_id, is_public').order('starts_at', { ascending: false })
    setEvents(data as EventRow[])
    setEventId((cur) => cur ?? (data as EventRow[] | null)?.find((e) => new Date(e.starts_at).getTime() > Date.now() - 12 * 3600e3)?.id ?? data?.[0]?.id)
  }, [])
  useEffect(() => { load() }, [load])
  const ev = events?.find((e) => e.id === eventId)
  if (!events) return <Spinner />
  return (
    <div className="setup">
      <div className="admin-bar">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
        </select>
        <a className="button button-small button-ghost" href="/opravovanie">Opravovanie →</a>
      </div>
      {ev && (ev.quiz_id ? <QuizEditor key={ev.quiz_id} quizId={ev.quiz_id} event={ev} /> : <CreateQuiz event={ev} onCreated={load} />)}
    </div>
  )
}

function CreateQuiz({ event, onCreated }: { event: EventRow; onCreated: () => void }) {
  const [busy, setBusy] = useState(false)
  async function create() {
    setBusy(true)
    const d = new Date(event.starts_at)
    const title = `${String(d.getDate()).padStart(2, '0')}.${String(d.getMonth() + 1).padStart(2, '0')}.${d.getFullYear()}`
    const { data: season } = await supabase.from('seasons').select('id').eq('is_active', true).maybeSingle()
    // kvíz k neverejnému (testovaciemu) eventu skryjeme: bez sezóny a s dátumom 2000 → nie je vo výsledkoch ani na /live
    const hidden = !event.is_public
    const { data: quiz, error } = await supabase.from('quizzes').insert({
      title, season_id: hidden ? null : season?.id ?? null, event_id: event.id, allow_new_teams: hidden,
      ...(hidden ? { created_at: '2000-01-01T00:00:00Z' } : {}),
    }).select('id').single()
    if (error || !quiz) { alert('Chyba: ' + error?.message); setBusy(false); return }
    for (let i = 0; i < 5; i++) {
      const { data: r } = await supabase.from('rounds').insert({ quiz_id: quiz.id, name: String(i + 1), round_order: i, published_at: null }).select('id').single()
      if (r) await supabase.from('round_topics').insert([1, 2].map((o) => ({ round_id: r.id, topic_order: o, max_points: 5 })))
    }
    // prepojenie spustí automatické vytvorenie tímov z registrácií
    await supabase.from('events').update({ quiz_id: quiz.id }).eq('id', event.id)
    setBusy(false)
    onCreated()
  }
  return (
    <article className="card center">
      <h1>{event.title}</h1>
      <p className="muted">{dateLong(event.starts_at)} o {time(event.starts_at)}</p>
      <p>K tomuto eventu ešte nie je vytvorený kvíz. Vytvorí sa s 5 kolami po 2 témach a tímy sa doň automaticky pridajú z registrácií.</p>
      <button className="button" disabled={busy} onClick={create}>{busy ? 'Vytváram…' : 'Vytvoriť kvíz'}</button>
    </article>
  )
}

function QuizEditor({ quizId, event }: { quizId: string; event: EventRow }) {
  const [quiz, setQuiz] = useState<{ title: string; season_id: string | null; allow_new_teams: boolean; created_at: string }>()
  const [seasons, setSeasons] = useState<Season[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [rounds, setRounds] = useState<Round[]>()
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    const [q, s, c, r, t] = await Promise.all([
      supabase.from('quizzes').select('title, season_id, allow_new_teams, created_at').eq('id', quizId).single(),
      supabase.from('seasons').select('id, name, is_active').order('start_date'),
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('rounds').select('id, name, round_order, kind, round_topics(id, topic_order, category_id, name, max_points, correct_answers(id, question_number, correct_answer, accept_alternatives, ai_note))').eq('quiz_id', quizId).order('round_order'),
      supabase.from('teams').select('id, name').eq('quiz_id', quizId).order('name'),
    ])
    setQuiz(q.data ?? undefined); setSeasons((s.data ?? []) as Season[]); setCats((c.data ?? []) as Category[])
    setRounds((r.data ?? []) as Round[]); setTeams(t.data ?? [])
  }, [quizId])
  useEffect(() => { load() }, [load])

  async function setSeason(id: string) {
    if (id === '__new') {
      const name = prompt('Názov novej sezóny (napr. 2026 Sep - Dec):')
      if (!name) return
      const y = new Date(event.starts_at).getFullYear()
      const { data, error } = await supabase.from('seasons').insert({ name, start_date: `${y}-01-01`, end_date: `${y}-12-31`, is_active: false }).select('id').single()
      if (error || !data) { alert('Chyba: ' + error?.message); return }
      id = data.id
      if (confirm('Nastaviť novú sezónu ako aktuálnu (predvolenú vo výsledkoch)?')) {
        await supabase.from('seasons').update({ is_active: false }).neq('id', id)
        await supabase.from('seasons').update({ is_active: true }).eq('id', id)
      }
    }
    await supabase.from('quizzes').update({ season_id: id }).eq('id', quizId)
    load()
  }
  async function addTeam() {
    const name = prompt('Názov tímu (bez registrácie):')
    if (!name) return
    const { error } = await supabase.from('teams').insert({ quiz_id: quizId, name: name.trim() })
    if (error) alert('Chyba: ' + error.message)
    load()
  }
  async function newCategory(): Promise<string | null> {
    const name = prompt('Názov novej témy:')
    if (!name) return null
    const { data, error } = await supabase.from('categories').insert({ name: name.trim() }).select('id').single()
    if (error || !data) { alert('Chyba: ' + error?.message); return null }
    await load()
    return data.id
  }

  if (!quiz || !rounds) return <Spinner />
  const sheetRounds = rounds.filter((r) => r.kind === 'sheet')
  const filled = sheetRounds.reduce((s, r) => s + r.round_topics.reduce((a, t) => a + t.correct_answers.filter((x) => x.correct_answer.trim()).length, 0), 0)
  const needed = sheetRounds.reduce((s, r) => s + r.round_topics.length * 5, 0)

  // ---- štruktúra kvízu (kolá, typ kola, témy, poradie)
  async function addRound(kind: 'sheet' | 'manual') {
    const order = rounds!.length
    const sheetNo = rounds!.filter((r) => r.kind === 'sheet').length + 1
    const name = kind === 'sheet' ? String(sheetNo) : 'Prestávkové kolo'
    const { data: r, error } = await supabase.from('rounds').insert({ quiz_id: quizId, name, round_order: order, kind, published_at: null }).select('id').single()
    if (error || !r) { alert('Chyba: ' + error?.message); return }
    await supabase.from('round_topics').insert(kind === 'sheet' ? [1, 2].map((o) => ({ round_id: r.id, topic_order: o, max_points: 5 })) : [{ round_id: r.id, topic_order: 1, max_points: 5 }])
    load()
  }
  async function deleteRound(r: Round) {
    const [{ count: subs }, { count: sc }] = await Promise.all([
      supabase.from('answer_submissions').select('id', { count: 'exact', head: true }).eq('round_id', r.id),
      supabase.from('scores').select('id', { count: 'exact', head: true }).eq('round_id', r.id),
    ])
    if ((subs ?? 0) + (sc ?? 0) > 0) { alert('Toto kolo už má odovzdané hárky alebo body – nedá sa zmazať.'); return }
    if (!confirm(`Zmazať kolo „${r.name}“ aj s jeho témami a odpoveďami?`)) return
    await supabase.from('rounds').delete().eq('id', r.id)
    const rest = rounds!.filter((x) => x.id !== r.id)
    await Promise.all(rest.map((x, i) => x.round_order !== i ? supabase.from('rounds').update({ round_order: i }).eq('id', x.id) : null))
    load()
  }
  async function moveRound(i: number, d: -1 | 1) {
    const a = rounds![i], b = rounds![i + d]
    if (!b) return
    await supabase.from('rounds').update({ round_order: -1 }).eq('id', a.id)
    await supabase.from('rounds').update({ round_order: a.round_order }).eq('id', b.id)
    await supabase.from('rounds').update({ round_order: b.round_order }).eq('id', a.id)
    load()
  }
  async function renameRound(r: Round, name: string) {
    const v = name.trim()
    if (!v || v === r.name) return
    await supabase.from('rounds').update({ name: v }).eq('id', r.id)
    r.name = v
  }
  async function setKind(r: Round, kind: 'sheet' | 'manual') {
    if (kind === 'sheet' && r.round_topics.length > 2) { alert('Kolo s hárkom môže mať najviac 2 témy (hárok má 10 riadkov). Najprv zmažte témy navyše.'); return }
    await supabase.from('rounds').update({ kind }).eq('id', r.id)
    load()
  }
  async function addTopic(r: Round) {
    const order = Math.max(0, ...r.round_topics.map((t) => t.topic_order)) + 1
    await supabase.from('round_topics').insert({ round_id: r.id, topic_order: order, max_points: 5 })
    load()
  }
  async function deleteTopic(r: Round, t: Topic) {
    if (r.round_topics.length <= 1) { alert('Kolo musí mať aspoň jednu tému.'); return }
    if (!confirm(`Zmazať tému ${t.topic_order}${t.name ? ` (${t.name})` : ''} aj s odpoveďami a bodmi?`)) return
    await supabase.from('round_topics').delete().eq('id', t.id)
    const rest = r.round_topics.filter((x) => x.id !== t.id).sort((a, b) => a.topic_order - b.topic_order)
    for (const [i, x] of rest.entries()) if (x.topic_order !== i + 1) await supabase.from('round_topics').update({ topic_order: i + 1 }).eq('id', x.id)
    load()
  }
  return (
    <>
      <article className="card">
        <h1>Kvíz {quiz.title}</h1>
        <p className="event-meta">{event.title} · {dateLong(event.starts_at)} o {time(event.starts_at)}</p>
        <div className="admin-bar">
          <label className="form" style={{ margin: 0 }}>Sezóna
            <select value={quiz.season_id ?? ''} onChange={(e) => setSeason(e.target.value)}>
              <option value="">– bez sezóny –</option>
              {seasons.map((s) => <option key={s.id} value={s.id}>{s.name}{s.is_active ? ' (aktuálna)' : ''}</option>)}
              <option value="__new">➕ Nová sezóna…</option>
            </select>
          </label>
          <span className={filled === needed ? 'success' : 'warn'}>Správne odpovede: {filled}/{needed}</span>
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={quiz.allow_new_teams} onChange={async (e) => {
            const v = e.target.checked
            await supabase.from('quizzes').update({ allow_new_teams: v }).eq('id', quizId)
            setQuiz({ ...quiz, allow_new_teams: v })
          }} />
          Tímy si môžu pri odovzdaní hárku napísať vlastný názov (bez registrácie)
        </label>
        {quiz.created_at < '2001' && (
          <p className="muted small">Skrytý kvíz – nie je vo výsledkoch, v lige ani na /live. Projektor: <a href={`/projektor?kviz=${quizId}`} target="_blank" rel="noreferrer">{location.origin}/projektor?kviz={quizId}</a></p>
        )}
      </article>

      <details className="card">
        <summary>Tímy ({teams.length}) – pridávajú sa automaticky z registrácií{quiz.allow_new_teams ? ' alebo pri odovzdaní' : ''}</summary>
        <p className="muted small">{teams.map((t) => t.name).join(' · ') || 'Zatiaľ žiadne.'}</p>
        <button className="button button-small button-ghost" onClick={addTeam}>➕ Pridať tím ručne</button>
      </details>

      {rounds.map((r, i) => (
        <article key={r.id} className={`card round-editor ${r.kind === 'manual' ? 'manual' : ''}`}>
          <div className="round-head">
            <input className="round-name" defaultValue={r.name} aria-label="Názov kola" onBlur={(e) => renameRound(r, e.target.value)} />
            <select value={r.kind} onChange={(e) => setKind(r, e.target.value as 'sheet' | 'manual')} aria-label="Typ kola">
              <option value="sheet">📷 Hárok – opravuje AI</option>
              <option value="manual">✍️ Prestávkové – ručné body</option>
            </select>
            <span className="round-tools">
              <button className="button button-small button-ghost" disabled={i === 0} onClick={() => moveRound(i, -1)} title="Posunúť vyššie">↑</button>
              <button className="button button-small button-ghost" disabled={i === rounds.length - 1} onClick={() => moveRound(i, 1)} title="Posunúť nižšie">↓</button>
              <button className="button button-small button-ghost" onClick={() => deleteRound(r)} title="Zmazať kolo">🗑</button>
            </span>
          </div>
          {r.kind === 'manual' && <p className="hint">Body zadáte v Opravovaní → Ručné body. Maximum môžete zmeniť aj neskôr.</p>}
          {[...r.round_topics].sort((a, b) => a.topic_order - b.topic_order).map((t) => (
            <TopicEditor key={t.id} topic={t} cats={cats} onNewCategory={newCategory} manual={r.kind === 'manual'} onDelete={r.round_topics.length > 1 ? () => deleteTopic(r, t) : undefined} />
          ))}
          {(r.kind === 'manual' ? r.round_topics.length < 6 : r.round_topics.length < 2) && (
            <button className="button button-small button-ghost" onClick={() => addTopic(r)}>➕ Pridať tému</button>
          )}
        </article>
      ))}
      <div className="cta-row center-row">
        <button className="button button-ghost" onClick={() => addRound('sheet')}>➕ Kolo s hárkom</button>
        <button className="button button-ghost" onClick={() => addRound('manual')}>➕ Prestávkové kolo</button>
      </div>
      <p className="hint center">Pokyn pre AI je nepovinný – napr. „interpret + pieseň, za každé ½ bodu“ alebo „stačí rok ±1“. Alternatívy AI rozpozná väčšinou sama.</p>
    </>
  )
}

function TopicEditor({ topic, cats, onNewCategory, manual, onDelete }: { topic: Topic; cats: Category[]; onNewCategory: () => Promise<string | null>; manual: boolean; onDelete?: () => void }) {
  const [maxPts, setMaxPts] = useState(String(topic.max_points ?? 5))
  async function saveMax() {
    const v = Number(maxPts.replace(',', '.'))
    if (!(v > 0) || v === Number(topic.max_points)) { setMaxPts(String(topic.max_points ?? 5)); return }
    await supabase.from('round_topics').update({ max_points: v }).eq('id', topic.id)
    topic.max_points = v
  }
  const [cat, setCat] = useState(topic.category_id ?? '')
  const [name, setName] = useState(topic.name ?? '')
  async function saveName() {
    const v = name.trim() || null
    if (v === (topic.name ?? null)) return
    await supabase.from('round_topics').update({ name: v }).eq('id', topic.id)
    topic.name = v
  }
  const answers = [1, 2, 3, 4, 5].map((n) => topic.correct_answers.find((a) => a.question_number === n) ?? { question_number: n, correct_answer: '', accept_alternatives: null, ai_note: null })
  async function changeCat(v: string) {
    if (v === '__new') { const id = await onNewCategory(); if (!id) return; v = id }
    setCat(v)
    await supabase.from('round_topics').update({ category_id: v || null }).eq('id', topic.id)
  }
  const offset = (topic.topic_order - 1) * 5
  return (
    <div className="topic-editor">
      <label className="topic-cat">Téma {topic.topic_order}
        <select value={cat} onChange={(e) => changeCat(e.target.value)}>
          <option value="">– vyberte tému –</option>
          {cats.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          <option value="__new">➕ Nová téma…</option>
        </select>
      </label>
      <label className="topic-cat">Názov témy <span className="hint">(vo výsledkoch, napr. Vikingovia)</span>
        <input value={name} placeholder="nepovinné" onChange={(e) => setName(e.target.value)} onBlur={saveName} />
      </label>
      <div className="topic-cat">
        <label className="topic-max">Max. bodov <input inputMode="decimal" value={maxPts} onChange={(e) => setMaxPts(e.target.value)} onBlur={saveMax} /></label>
        {onDelete && <button className="button button-small button-ghost" onClick={onDelete}>🗑 Zmazať tému</button>}
      </div>
      {!manual && answers.map((a) => <AnswerRow key={a.question_number} topicId={topic.id} answer={a} label={offset + a.question_number} />)}
    </div>
  )
}

function AnswerRow({ topicId, answer, label }: { topicId: string; answer: Answer; label: number }) {
  const [correct, setCorrect] = useState(answer.correct_answer)
  const [alts, setAlts] = useState((answer.accept_alternatives ?? []).join(', '))
  const [note, setNote] = useState(answer.ai_note ?? '')
  const [state, setState] = useState<'' | 'saving' | 'saved' | 'error'>('')
  async function save() {
    const row = {
      round_topic_id: topicId, question_number: answer.question_number, correct_answer: correct.trim(),
      accept_alternatives: alts.split(',').map((s) => s.trim()).filter(Boolean), ai_note: note.trim() || null,
    }
    if (row.correct_answer === answer.correct_answer && (answer.ai_note ?? '') === (row.ai_note ?? '') && (answer.accept_alternatives ?? []).join(',') === row.accept_alternatives.join(',')) return
    setState('saving')
    const { error } = await supabase.from('correct_answers').upsert(row, { onConflict: 'round_topic_id,question_number' })
    setState(error ? 'error' : 'saved')
    if (!error) { answer.correct_answer = row.correct_answer; answer.ai_note = row.ai_note; answer.accept_alternatives = row.accept_alternatives }
  }
  return (
    <div className="answer-row">
      <span className="qn">{label}.</span>
      <input placeholder="Správna odpoveď" value={correct} onChange={(e) => setCorrect(e.target.value)} onBlur={save} />
      <input placeholder="Uznať aj (čiarkou)" value={alts} onChange={(e) => setAlts(e.target.value)} onBlur={save} />
      <input placeholder="Pokyn pre AI (nepovinné)" value={note} onChange={(e) => setNote(e.target.value)} onBlur={save} />
      <span className={`save-state ${state}`}>{state === 'saving' ? '…' : state === 'saved' ? '✓' : state === 'error' ? '⚠' : ''}</span>
    </div>
  )
}
