import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { time } from '../lib/format'
import { Spinner } from '../components'
import { AdminGate } from '../AdminGate'

// Opravovanie: AI hodnotí hárky na serveri, sem prichádzajú iba pochybné odpovede.
// Každý opravovateľ dostane inú odpoveď (zámok v databáze), súčty počíta databáza.

type Quiz = { id: string; title: string; created_at: string; submit_open: boolean; submit_round_id: string | null; submit_closes_at: string | null }
type Round = { id: string; name: string; round_order: number; published_at: string | null }
type Team = { id: string; name: string }
type Sub = { id: string; team_id: string; status: string; ai_status: string; ai_error: string | null; submitted_at: string; photo_path: string }
type Ev = { id: string; submission_id: string; question_number: number; ocr_text: string | null; correct_answer: string | null; points: number | null; final_points: number | null; needs_review: boolean; review_reason: string | null; reasoning: string | null; box: number[] | null }
type ReviewItem = { id: string; question_number: number; ocr_text: string; correct_answer: string; points: number; confidence: number; reasoning: string | null; review_reason: string | null; box: number[] | null; team_name: string; photo_path: string; topic: string | null; ai_note: string | null }

const fmtPts = (p: number | null | undefined) => (p == null ? '–' : p === 0.5 ? '½' : String(p).replace('.5', '½'))

export default function Grading() {
  return <AdminGate>{() => <GradingScreen />}</AdminGate>
}

function GradingScreen() {
  const [quizzes, setQuizzes] = useState<Quiz[]>()
  const [quizId, setQuizId] = useState<string>()
  const [rounds, setRounds] = useState<Round[]>([])
  const [roundId, setRoundId] = useState<string>()

  const loadQuizzes = useCallback(async () => {
    const { data } = await supabase.from('quizzes').select('id, title, created_at, submit_open, submit_round_id, submit_closes_at').order('created_at', { ascending: false }).limit(30)
    setQuizzes(data as Quiz[])
    setQuizId((cur) => cur ?? (data as Quiz[] | null)?.[0]?.id)
  }, [])
  useEffect(() => { loadQuizzes() }, [loadQuizzes])

  const loadRounds = useCallback(async () => {
    if (!quizId) return
    const { data } = await supabase.from('rounds').select('id, name, round_order, published_at').eq('quiz_id', quizId).order('round_order')
    setRounds(data as Round[])
    setRoundId((cur) => (data as Round[]).some((r) => r.id === cur) ? cur : (data as Round[])[0]?.id)
  }, [quizId])
  useEffect(() => { loadRounds() }, [loadRounds])

  const quiz = quizzes?.find((q) => q.id === quizId)
  const round = rounds.find((r) => r.id === roundId)
  if (!quizzes) return <Spinner />
  return (
    <div className="grading">
      <div className="admin-bar">
        <select value={quizId} onChange={(e) => { setQuizId(e.target.value); setRoundId(undefined) }}>
          {quizzes.map((q) => <option key={q.id} value={q.id}>{q.title}{q.created_at.startsWith('2000') ? ' (test)' : ''}</option>)}
        </select>
        <span className="cta-row">
          <a className="button button-small button-ghost" href="/priprava">Príprava kvízu</a>
          <a className="button button-small button-ghost" href="/projektor" target="_blank">Projektor ↗</a>
        </span>
      </div>
      <nav className="round-tabs">
        {rounds.map((r) => (
          <button key={r.id} className={r.id === roundId ? 'active' : ''} onClick={() => setRoundId(r.id)}>
            {r.name}. kolo {r.published_at ? '📢' : ''}
          </button>
        ))}
      </nav>
      {quiz && round ? <RoundPanel key={round.id} quiz={quiz} round={round} onQuizChanged={loadQuizzes} onRoundChanged={loadRounds} /> : <p className="card muted center">Kvíz nemá kolá. Nastavte ich v Príprave kvízu.</p>}
    </div>
  )
}

function RoundPanel({ quiz, round, onQuizChanged, onRoundChanged }: { quiz: Quiz; round: Round; onQuizChanged: () => void; onRoundChanged: () => void }) {
  const [teams, setTeams] = useState<Team[]>([])
  const [subs, setSubs] = useState<Sub[]>([])
  const [evs, setEvs] = useState<Ev[]>([])
  const [scores, setScores] = useState<Record<string, number>>({})
  const [reviewing, setReviewing] = useState(false)
  const [sheet, setSheet] = useState<Sub>()

  const load = useCallback(async () => {
    const [t, s, sc] = await Promise.all([
      supabase.from('teams').select('id, name').eq('quiz_id', quiz.id).order('name'),
      supabase.from('answer_submissions').select('id, team_id, status, ai_status, ai_error, submitted_at, photo_path').eq('round_id', round.id).in('status', ['pending', 'reviewed']),
      supabase.from('scores').select('team_id, score').eq('round_id', round.id),
    ])
    const subList = (s.data ?? []) as Sub[]
    setTeams((t.data ?? []) as Team[])
    setSubs(subList)
    setScores(Object.fromEntries(((sc.data ?? []) as { team_id: string; score: number }[]).map((x) => [x.team_id, Number(x.score)])))
    if (subList.length) {
      const { data } = await supabase.from('ai_evaluations')
        .select('id, submission_id, question_number, ocr_text, correct_answer, points, final_points, needs_review, review_reason, reasoning, box')
        .in('submission_id', subList.map((x) => x.id))
      setEvs((data ?? []) as Ev[])
    } else setEvs([])
  }, [quiz.id, round.id])

  useEffect(() => {
    load()
    let t: ReturnType<typeof setTimeout>
    const debounced = () => { clearTimeout(t); t = setTimeout(load, 700) }
    const ch = supabase.channel(`grading-${round.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'answer_submissions', filter: `round_id=eq.${round.id}` }, debounced)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'ai_evaluations' }, debounced)
      .subscribe()
    const poll = setInterval(load, 20000) // poistka, keby realtime vypadol
    return () => { supabase.removeChannel(ch); clearInterval(poll); clearTimeout(t) }
  }, [load, round.id])

  const subByTeam = useMemo(() => Object.fromEntries(subs.map((s) => [s.team_id, s])), [subs])
  const openReviews = evs.filter((e) => e.needs_review && e.final_points == null).length
  const aiDone = subs.filter((s) => s.ai_status === 'completed').length
  const aiBusy = subs.filter((s) => s.ai_status === 'pending' || s.ai_status === 'processing').length
  const aiFailed = subs.filter((s) => s.ai_status === 'failed')

  return (
    <>
      <SubmitWindow quiz={quiz} round={round} onChanged={onQuizChanged} />

      <div className="grading-stats">
        <div><strong>{subs.length}</strong>/{teams.length}<span>odovzdaných</span></div>
        <div><strong>{aiDone}</strong>{aiBusy ? <em> +{aiBusy}⏳</em> : null}<span>vyhodnotila AI</span></div>
        <div className={openReviews ? 'warn-box' : ''}><strong>{openReviews}</strong><span>na kontrolu</span></div>
        <div><strong>{round.published_at ? '📢' : '–'}</strong><span>{round.published_at ? `zverejnené ${time(round.published_at)}` : 'nezverejnené'}</span></div>
      </div>

      <div className="cta-row grading-actions">
        <button className="button" disabled={!openReviews} onClick={() => setReviewing(true)}>✅ Kontrolovať ({openReviews})</button>
        <PublishButton round={round} openReviews={openReviews} aiBusy={aiBusy} missing={teams.length - subs.length} onChanged={onRoundChanged} />
      </div>

      {aiFailed.length > 0 && (
        <p className="alert">AI zlyhala pri {aiFailed.length} hárkoch – skúša to znova automaticky. Posledná chyba: {aiFailed[0].ai_error}</p>
      )}

      <div className="team-grid">
        {teams.map((t) => {
          const s = subByTeam[t.id]
          const pending = s ? evs.filter((e) => e.submission_id === s.id && e.needs_review && e.final_points == null).length : 0
          const state = !s ? 'none' : s.ai_status !== 'completed' ? (s.ai_status === 'failed' ? 'failed' : 'ai') : pending ? 'review' : 'done'
          return (
            <button key={t.id} className={`team-chip st-${state}`} disabled={!s} onClick={() => s && setSheet(s)}>
              <span className="team-chip-name">{t.name}</span>
              <span className="team-chip-state">
                {state === 'none' && 'neodovzdali'}
                {state === 'ai' && '⏳ AI hodnotí'}
                {state === 'failed' && '⚠ AI chyba'}
                {state === 'review' && `${fmtPts(scores[t.id])} b · ${pending} na kontrolu`}
                {state === 'done' && `${fmtPts(scores[t.id])} b ✓`}
              </span>
            </button>
          )
        })}
      </div>

      {reviewing && <ReviewQueue roundId={round.id} onClose={() => { setReviewing(false); load() }} />}
      {sheet && <SheetModal sub={sheet} team={teams.find((t) => t.id === sheet.team_id)!} evs={evs.filter((e) => e.submission_id === sheet.id)} onClose={() => { setSheet(undefined); load() }} />}
    </>
  )
}

function SubmitWindow({ quiz, round, onChanged }: { quiz: Quiz; round: Round; onChanged: () => void }) {
  const [minutes, setMinutes] = useState(5)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const closes = quiz.submit_closes_at ? new Date(quiz.submit_closes_at).getTime() : 0
  const openHere = quiz.submit_open && quiz.submit_round_id === round.id && closes > now
  const openOther = quiz.submit_open && quiz.submit_round_id !== round.id && closes > now
  const left = Math.max(0, Math.floor((closes - now) / 1000))
  useEffect(() => { if (quiz.submit_open && closes && closes < now) onChanged() }, [closes, now, quiz.submit_open, onChanged])

  const set = async (roundId: string | null, mins: number) => {
    const { error } = await supabase.rpc('set_submit_window', { p_quiz_id: quiz.id, p_round_id: roundId, p_minutes: mins })
    if (error) alert('Chyba: ' + error.message)
    onChanged()
  }
  return (
    <div className={`submit-window card ${openHere ? 'open' : ''}`}>
      {openHere ? (
        <>
          <strong>🔓 Odovzdávanie {round.name}. kola je otvorené</strong> – zatvára sa o {Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}
          <span className="cta-row">
            <button className="button button-small button-ghost" onClick={() => set(round.id, Math.ceil(left / 60) + 2)}>+2 min</button>
            <button className="button button-small button-danger" onClick={() => set(null, 0)}>Zatvoriť</button>
          </span>
        </>
      ) : (
        <>
          <span>{openOther ? '⚠ Otvorené je odovzdávanie iného kola.' : '🔒 Odovzdávanie je zatvorené.'} Tímy odovzdávajú na <strong>kvizfactory.sk/odovzdat</strong></span>
          <span className="cta-row">
            <select value={minutes} onChange={(e) => setMinutes(Number(e.target.value))} className="size-select">
              {[3, 5, 8, 10, 15].map((m) => <option key={m} value={m}>{m} min</option>)}
            </select>
            <button className="button button-small" onClick={() => set(round.id, minutes)}>Otvoriť {round.name}. kolo</button>
          </span>
        </>
      )}
    </div>
  )
}

function PublishButton({ round, openReviews, aiBusy, missing, onChanged }: { round: Round; openReviews: number; aiBusy: number; missing: number; onChanged: () => void }) {
  async function toggle() {
    if (!round.published_at) {
      const warn = [openReviews && `${openReviews} odpovedí čaká na kontrolu`, aiBusy && `${aiBusy} hárkov ešte hodnotí AI`, missing > 0 && `${missing} tímov neodovzdalo`].filter(Boolean)
      if (!confirm(`Zverejniť body ${round.name}. kola na projektore a webe?${warn.length ? '\n\nPozor: ' + warn.join(', ') + '.' : ''}`)) return
    } else if (!confirm(`Skryť body ${round.name}. kola z projektora?`)) return
    const { error } = await supabase.rpc('publish_round', { p_round_id: round.id, p_publish: !round.published_at })
    if (error) alert('Chyba: ' + error.message)
    onChanged()
  }
  return round.published_at
    ? <button className="button button-ghost" onClick={toggle}>Skryť z projektora</button>
    : <button className="button button-yellow" onClick={toggle}>📢 Zverejniť kolo</button>
}

// Výrez riadku odpovede z fotky podľa box [ymin, xmin, ymax, xmax] (0–1000)
function Crop({ url, box }: { url: string; box: number[] | null }) {
  const [size, setSize] = useState<{ w: number; h: number }>()
  if (!box) return <img className="crop-full" src={url} alt="Hárok" />
  const y0 = Math.max(0, box[0] - 30), y1 = Math.min(1000, box[2] + 30)
  const ratio = size ? (size.w * 1) / (size.h * ((y1 - y0) / 1000)) : 6
  return (
    <div className="crop" style={{ aspectRatio: String(ratio) }}>
      <img src={url} alt="Odpoveď" onLoad={(e) => setSize({ w: e.currentTarget.naturalWidth, h: e.currentTarget.naturalHeight })}
        style={{ top: `${-(y0 / (y1 - y0)) * 100}%`, height: `${(1000 / (y1 - y0)) * 100}%` }} />
    </div>
  )
}

const urlCache = new Map<string, string>()
async function signedUrl(path: string) {
  if (urlCache.has(path)) return urlCache.get(path)!
  const { data } = await supabase.storage.from('answer-sheets').createSignedUrl(path, 3600)
  if (data?.signedUrl) urlCache.set(path, data.signedUrl)
  return data?.signedUrl ?? ''
}

function ReviewQueue({ roundId, onClose }: { roundId: string; onClose: () => void }) {
  const [item, setItem] = useState<ReviewItem | null>()
  const [url, setUrl] = useState('')
  const [full, setFull] = useState(false)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState(0)

  const next = useCallback(async () => {
    setFull(false)
    const { data, error } = await supabase.rpc('claim_next_review', { p_round_id: roundId })
    if (error) { alert('Chyba: ' + error.message); return }
    const it = data as ReviewItem | null
    if (it) setUrl(await signedUrl(it.photo_path))
    setItem(it)
  }, [roundId])
  useEffect(() => { next() }, [next])

  const decide = useCallback(async (points: number) => {
    if (!item || busy) return
    setBusy(true)
    const { error } = await supabase.rpc('review_answer', { p_eval_id: item.id, p_points: points })
    setBusy(false)
    if (error) { alert('Chyba: ' + error.message); return }
    setDone((d) => d + 1)
    next()
  }, [item, busy, next])

  // klávesy: 1 = správne, H = polovica, 0 = nesprávne, F = celý hárok, Esc = koniec
  const keyRef = useRef(decide)
  keyRef.current = decide
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === '1') keyRef.current(1)
      else if (e.key === 'h' || e.key === 'H' || e.key === '5') keyRef.current(0.5)
      else if (e.key === '0') keyRef.current(0)
      else if (e.key === 'f' || e.key === 'F') setFull((f) => !f)
      else if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="modal-overlay">
      <div className="modal review">
        <div className="modal-head">
          <strong>Kontrola odpovedí</strong>
          <span className="muted small">skontrolované: {done}</span>
          <button className="button button-small button-ghost" onClick={onClose}>Zavrieť</button>
        </div>
        {item === undefined && <Spinner />}
        {item === null && <div className="center"><p className="lead">Všetko skontrolované ✓</p><button className="button" onClick={onClose}>Späť</button></div>}
        {item && (
          <>
            <div className="review-meta">
              <strong>{item.team_name}</strong> · otázka {item.question_number}{item.topic ? ` · ${item.topic}` : ''}
              <span className="pill">{item.review_reason}</span>
            </div>
            {url && (full ? <img className="crop-full" src={url} alt="Hárok" /> : <Crop url={url} box={item.box} />)}
            <button className="link small" onClick={() => setFull((f) => !f)}>{full ? 'Zobraziť iba riadok' : 'Zobraziť celý hárok (F)'}</button>
            <dl className="review-dl">
              <dt>Správne</dt><dd><strong>{item.correct_answer}</strong>{item.ai_note && <span className="muted"> · {item.ai_note}</span>}</dd>
              <dt>AI prečítala</dt><dd>{item.ocr_text || <em className="muted">prázdne</em>}</dd>
              <dt>Návrh AI</dt><dd>{fmtPts(item.points)} b – {item.reasoning}</dd>
            </dl>
            <div className="review-buttons">
              <button className="rb rb-yes" disabled={busy} onClick={() => decide(1)}>✓ 1 bod<small>kláves 1</small></button>
              <button className="rb rb-half" disabled={busy} onClick={() => decide(0.5)}>½ bodu<small>kláves H</small></button>
              <button className="rb rb-no" disabled={busy} onClick={() => decide(0)}>✗ 0<small>kláves 0</small></button>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function SheetModal({ sub, team, evs, onClose }: { sub: Sub; team: Team; evs: Ev[]; onClose: () => void }) {
  const [url, setUrl] = useState('')
  const [local, setLocal] = useState<Record<string, number>>({})
  useEffect(() => { signedUrl(sub.photo_path).then(setUrl) }, [sub.photo_path])
  const set = async (e: Ev, p: number) => {
    setLocal((l) => ({ ...l, [e.id]: p }))
    const { error } = await supabase.rpc('review_answer', { p_eval_id: e.id, p_points: p })
    if (error) alert('Chyba: ' + error.message)
  }
  const sorted = [...evs].sort((a, b) => a.question_number - b.question_number)
  const total = sorted.reduce((s, e) => s + (local[e.id] ?? e.final_points ?? e.points ?? 0), 0)
  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal sheet" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <strong>{team.name}</strong><span className="muted small">odovzdané {time(sub.submitted_at)} · spolu {fmtPts(total)} b</span>
          <button className="button button-small button-ghost" onClick={onClose}>Zavrieť</button>
        </div>
        <div className="sheet-body">
          {url && <a href={url} target="_blank" rel="noreferrer"><img className="sheet-photo" src={url} alt="Hárok" /></a>}
          <table className="regs">
            <thead><tr><th>#</th><th>Prečítané / správne</th><th>Body</th></tr></thead>
            <tbody>
              {sorted.map((e) => {
                const cur = local[e.id] ?? e.final_points ?? e.points ?? 0
                return (
                  <tr key={e.id} className={e.needs_review && e.final_points == null && local[e.id] == null ? 'needs-review' : ''}>
                    <td>{e.question_number}</td>
                    <td>{e.ocr_text || <em className="muted">prázdne</em>}<br /><span className="muted small">✔ {e.correct_answer}{e.reasoning ? ` · ${e.reasoning}` : ''}</span></td>
                    <td className="pts">
                      {[1, 0.5, 0].map((p) => (
                        <button key={p} className={`pt ${cur === p ? 'on' : ''}`} onClick={() => set(e, p)}>{fmtPts(p)}</button>
                      ))}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
          {sorted.length === 0 && <p className="muted">AI tento hárok ešte nevyhodnotila.</p>}
        </div>
      </div>
    </div>
  )
}
