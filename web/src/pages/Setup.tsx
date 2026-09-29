import { useCallback, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dateLong, time } from '../lib/format'
import { Spinner } from '../components'
import { AdminGate } from '../AdminGate'

// Príprava kvízu: prepojenie s eventom (tímy z registrácií), sezóna, kolá, témy a správne odpovede.
// Každé pole sa ukladá samostatne hneď po úprave – žiadne veľké „Uložiť“.

type EventRow = { id: string; title: string; starts_at: string; quiz_id: string | null }
type Season = { id: string; name: string; is_active: boolean }
type Category = { id: string; name: string }
type Answer = { id?: string; question_number: number; correct_answer: string; accept_alternatives: string[] | null; ai_note: string | null }
type Topic = { id: string; topic_order: number; category_id: string | null; correct_answers: Answer[] }
type Round = { id: string; name: string; round_order: number; round_topics: Topic[] }

export default function Setup() {
  return <AdminGate>{() => <SetupScreen />}</AdminGate>
}

function SetupScreen() {
  const [events, setEvents] = useState<EventRow[]>()
  const [eventId, setEventId] = useState<string>()
  const load = useCallback(async () => {
    const { data } = await supabase.from('events').select('id, title, starts_at, quiz_id').order('starts_at', { ascending: false })
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
    const { data: quiz, error } = await supabase.from('quizzes').insert({ title, season_id: season?.id ?? null, event_id: event.id }).select('id').single()
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
  const [quiz, setQuiz] = useState<{ title: string; season_id: string | null }>()
  const [seasons, setSeasons] = useState<Season[]>([])
  const [cats, setCats] = useState<Category[]>([])
  const [rounds, setRounds] = useState<Round[]>()
  const [teams, setTeams] = useState<{ id: string; name: string }[]>([])

  const load = useCallback(async () => {
    const [q, s, c, r, t] = await Promise.all([
      supabase.from('quizzes').select('title, season_id').eq('id', quizId).single(),
      supabase.from('seasons').select('id, name, is_active').order('start_date'),
      supabase.from('categories').select('id, name').order('name'),
      supabase.from('rounds').select('id, name, round_order, round_topics(id, topic_order, category_id, correct_answers(id, question_number, correct_answer, accept_alternatives, ai_note))').eq('quiz_id', quizId).order('round_order'),
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
  const filled = rounds.reduce((s, r) => s + r.round_topics.reduce((a, t) => a + t.correct_answers.filter((x) => x.correct_answer.trim()).length, 0), 0)
  const needed = rounds.length * 10
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
      </article>

      <details className="card">
        <summary>Tímy ({teams.length}) – pridávajú sa automaticky z registrácií</summary>
        <p className="muted small">{teams.map((t) => t.name).join(' · ') || 'Zatiaľ žiadne.'}</p>
        <button className="button button-small button-ghost" onClick={addTeam}>➕ Pridať tím ručne</button>
      </details>

      {rounds.map((r) => (
        <article key={r.id} className="card">
          <h2>{r.name}. kolo</h2>
          {[...r.round_topics].sort((a, b) => a.topic_order - b.topic_order).map((t) => (
            <TopicEditor key={t.id} topic={t} cats={cats} onNewCategory={newCategory} />
          ))}
        </article>
      ))}
      <p className="hint center">Pokyn pre AI je nepovinný – napr. „interpret + pieseň, za každé ½ bodu“ alebo „stačí rok ±1“. Alternatívy AI rozpozná väčšinou sama.</p>
    </>
  )
}

function TopicEditor({ topic, cats, onNewCategory }: { topic: Topic; cats: Category[]; onNewCategory: () => Promise<string | null> }) {
  const [cat, setCat] = useState(topic.category_id ?? '')
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
      {answers.map((a) => <AnswerRow key={a.question_number} topicId={topic.id} answer={a} label={offset + a.question_number} />)}
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
