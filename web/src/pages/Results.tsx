import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components'

// Výsledky a liga – náhrada starého leaderboardu (/vysledky/).
// Verejnosť dostane z databázy iba zverejnené kolá, takže počas kvízu tu nič neunikne.

type Season = { id: string; name: string; is_active: boolean }
type Quiz = { id: string; title: string; created_at: string; season_id: string | null }
type Team = { id: string; name: string; quiz_id: string }
type Round = { id: string; quiz_id: string; name: string; round_order: number }
type Topic = { id: string; round_id: string; category_id: string | null; topic_order: number; max_points: number | null; name: string | null }
type Cat = { id: string; name: string; icon: string | null }
type TopicScore = { team_id: string; round_topic_id: string; score: number }
type RoundScore = { team_id: string; round_id: string; score: number }

const fmt = (n: number) => {
  const r = Math.round(n * 10) / 10
  if (Number.isInteger(r)) return String(r)
  return Math.abs(r % 1) === 0.5 ? String(Math.trunc(r)).replace(/^0$/, '') + '½' : r.toFixed(1).replace('.', ',')
}
const pct = (s: number, m: number) => (m > 0 ? Math.round((s / m) * 100) : 0)
const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim()
const medal = (place: number) => (place <= 3 ? ['🥇', '🥈', '🥉'][place - 1] : `${place}.`)

// Supabase vracia max. 1000 riadkov – väčšie zoznamy načítame po stranách a „in“ po dávkach
async function fetchIn<T>(table: string, cols: string, col: string, ids: string[]): Promise<T[]> {
  const out: T[] = []
  for (let i = 0; i < ids.length; i += 150) {
    const chunk = ids.slice(i, i + 150)
    for (let from = 0; ; from += 1000) {
      const { data, error } = await supabase.from(table).select(cols).in(col, chunk).range(from, from + 999)
      if (error) throw error
      out.push(...((data ?? []) as T[]))
      if (!data || data.length < 1000) break
    }
  }
  return out
}

type QuizData = { teams: Team[]; rounds: Round[]; topics: Topic[]; ts: TopicScore[]; rs: RoundScore[] }

async function loadQuizzes(quizIds: string[]): Promise<QuizData> {
  const [teams, rounds] = await Promise.all([
    fetchIn<Team>('teams', 'id, name, quiz_id', 'quiz_id', quizIds),
    fetchIn<Round>('rounds', 'id, quiz_id, name, round_order', 'quiz_id', quizIds),
  ])
  const rIds = rounds.map((r) => r.id)
  const [topics, rs] = await Promise.all([
    fetchIn<Topic>('round_topics', 'id, round_id, category_id, topic_order, max_points, name', 'round_id', rIds),
    fetchIn<RoundScore>('scores', 'team_id, round_id, score', 'round_id', rIds),
  ])
  const ts = await fetchIn<TopicScore>('topic_scores', 'team_id, round_topic_id, score', 'round_topic_id', topics.map((t) => t.id))
  return { teams, rounds, topics, ts, rs }
}

export default function Results() {
  const [params, setParams] = useSearchParams()
  const [seasons, setSeasons] = useState<Season[]>()
  const [quizzes, setQuizzes] = useState<Quiz[]>([])
  const [cats, setCats] = useState<Map<string, Cat>>(new Map())
  const [error, setError] = useState(false)

  useEffect(() => {
    Promise.all([
      supabase.from('seasons').select('id, name, is_active').order('start_date').order('created_at'),
      supabase.from('quizzes').select('id, title, created_at, season_id').gt('created_at', '2001-01-01').order('created_at', { ascending: false }),
      supabase.from('categories').select('id, name, icon'),
    ]).then(([s, q, c]) => {
      if (s.error || q.error) { setError(true); return }
      const qs = (q.data ?? []) as Quiz[]
      setQuizzes(qs)
      setSeasons(((s.data ?? []) as Season[]).filter((x) => qs.some((z) => z.season_id === x.id)))
      setCats(new Map(((c.data ?? []) as Cat[]).map((x) => [x.id, x])))
    })
  }, [])

  const view = params.get('pohlad') === 'liga' ? 'liga' : 'kviz'
  const seasonId = params.get('sezona') ?? seasons?.find((s) => s.is_active)?.id ?? seasons?.[seasons.length - 1]?.id
  const seasonQuizzes = useMemo(() => quizzes.filter((q) => q.season_id === seasonId), [quizzes, seasonId])
  const quizId = params.get('kviz') ?? seasonQuizzes[0]?.id

  function set(next: Record<string, string | null>) {
    const p = new URLSearchParams(params)
    for (const [k, v] of Object.entries(next)) v == null ? p.delete(k) : p.set(k, v)
    setParams(p, { replace: true })
  }

  if (error) return <p className="alert">Výsledky sa nepodarilo načítať. Skúste obnoviť stránku.</p>
  if (!seasons) return <Spinner />

  return (
    <div className="results">
      <div className="results-head">
        <h1>{view === 'liga' ? `Liga · ${seasons.find((s) => s.id === seasonId)?.name ?? ''}` : `Výsledky · ${quizzes.find((q) => q.id === quizId)?.title ?? ''}`}</h1>
      <div className="results-controls">
        <div className="seg" role="tablist">
          <button role="tab" aria-selected={view === 'kviz'} className={view === 'kviz' ? 'on' : ''} onClick={() => set({ pohlad: null })}>Kvíz</button>
          <button role="tab" aria-selected={view === 'liga'} className={view === 'liga' ? 'on' : ''} onClick={() => set({ pohlad: 'liga', kviz: null })}>Liga</button>
        </div>
        <label>Sezóna
          <select value={seasonId ?? ''} onChange={(e) => set({ sezona: e.target.value, kviz: null })}>
            {[...seasons].reverse().map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
        </label>
        {view === 'kviz' && (
          <label>Kvíz
            <select value={quizId ?? ''} onChange={(e) => set({ kviz: e.target.value })}>
              {seasonQuizzes.map((q) => <option key={q.id} value={q.id}>{q.title}</option>)}
            </select>
          </label>
        )}
      </div>
      </div>

      {view === 'kviz'
        ? (quizId ? <QuizResults key={quizId} quiz={quizzes.find((q) => q.id === quizId)!} cats={cats} /> : <p className="card center">V tejto sezóne zatiaľ nie je žiadny kvíz.</p>)
        : <League key={seasonId} quizzes={seasonQuizzes} cats={cats} />}
    </div>
  )
}

// ---------------------------------------------------------------- jeden kvíz

type TeamRow = { id: string; name: string; perRound: number[]; total: number; topics: { round: number; name: string; icon: string; score: number; max: number }[]; place: number }

function rankRows<T extends { total: number; name: string }>(rows: T[]): (T & { place: number })[] {
  const sorted = [...rows].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name, 'sk'))
  let place = 0, prev = NaN
  return sorted.map((r, i) => { if (r.total !== prev) { place = i + 1; prev = r.total } return { ...r, place } })
}

function QuizResults({ quiz, cats }: { quiz: Quiz; cats: Map<string, Cat> }) {
  const [data, setData] = useState<QuizData>()
  const [open, setOpen] = useState<string>()
  useEffect(() => { loadQuizzes([quiz.id]).then(setData).catch(() => setData({ teams: [], rounds: [], topics: [], ts: [], rs: [] })) }, [quiz.id])

  const calc = useMemo(() => {
    if (!data) return null
    const rounds = [...data.rounds].sort((a, b) => a.round_order - b.round_order)
    const topicsBy = new Map<string, Topic[]>()
    for (const t of data.topics) topicsBy.set(t.round_id, [...(topicsBy.get(t.round_id) ?? []), t].sort((a, b) => a.topic_order - b.topic_order))
    const tsMap = new Map(data.ts.map((s) => [s.team_id + '|' + s.round_topic_id, Math.max(0, Number(s.score))]))
    const rsMap = new Map(data.rs.map((s) => [s.team_id + '|' + s.round_id, Math.max(0, Number(s.score))]))
    // zverejnené = kolá, ku ktorým databáza vydala body
    const published = rounds.filter((r) => data.rs.some((s) => s.round_id === r.id) || (topicsBy.get(r.id) ?? []).some((t) => data.ts.some((s) => s.round_topic_id === t.id)))
    const catOf = (t: Topic) => cats.get(t.category_id ?? '')
    const rows: TeamRow[] = rankRows(data.teams.map((team) => {
      const topics: TeamRow['topics'] = []
      const perRound = published.map((r, ri) => {
        const ts = topicsBy.get(r.id) ?? []
        const hasTopicScores = ts.some((t) => tsMap.has(team.id + '|' + t.id))
        if (!hasTopicScores) return rsMap.get(team.id + '|' + r.id) ?? 0
        let sum = 0
        for (const t of ts) {
          const s = tsMap.get(team.id + '|' + t.id) ?? 0
          sum += s
          topics.push({ round: ri + 1, name: t.name || catOf(t)?.name || `Téma ${t.topic_order}`, icon: catOf(t)?.icon ?? '', score: s, max: t.max_points ?? 5 })
        }
        return sum
      })
      return { id: team.id, name: team.name, perRound, total: perRound.reduce((a, b) => a + b, 0), topics }
    }).filter((r) => r.perRound.length && (r.total > 0 || data.rs.some((s) => s.team_id === r.id) || data.ts.some((s) => s.team_id === r.id))))

    const roundWinners = published.map((_r, ri) => {
      const best = Math.max(0, ...rows.map((x) => x.perRound[ri]))
      return { name: `${ri + 1}. kolo`, score: best, teams: rows.filter((x) => x.perRound[ri] === best && best > 0).map((x) => x.name) }
    })
    // témy kvízu (každá téma zvlášť, v poradí kôl)
    const topicStats = published.flatMap((r, ri) => (topicsBy.get(r.id) ?? []).map((t) => {
      const scores = rows.map((x) => ({ name: x.name, s: tsMap.get(x.id + '|' + t.id) ?? 0 }))
      const max = t.max_points ?? 5
      const avg = scores.length ? scores.reduce((a, b) => a + b.s, 0) / scores.length : 0
      const best = Math.max(0, ...scores.map((x) => x.s))
      return { key: t.id, round: ri + 1, cat: t.name ? catOf(t)?.name ?? '' : '', name: t.name || catOf(t)?.name || `Téma ${t.topic_order}`, icon: catOf(t)?.icon ?? '', avg, max, best, winners: scores.filter((x) => x.s === best && best > 0).map((x) => x.name) }
    }))
    const avgTotal = rows.length ? rows.reduce((a, b) => a + b.total, 0) / rows.length : 0
    const maxTotal = published.reduce((a, r) => a + ((topicsBy.get(r.id) ?? []).reduce((b, t) => b + (t.max_points ?? 5), 0) || 10), 0)
    return { rows, published, roundWinners, topicStats, avgTotal, maxTotal }
  }, [data, cats])

  if (!calc) return <Spinner />
  if (!calc.rows.length) return <p className="card center">Výsledky tohto kvízu zatiaľ neboli zverejnené.</p>
  const { rows, published, roundWinners, topicStats, avgTotal, maxTotal } = calc
  const sortedTopics = [...topicStats].sort((a, b) => a.avg / a.max - b.avg / b.max)
  const hardest = sortedTopics[0], easiest = sortedTopics[sortedTopics.length - 1]

  return (
    <>
      <div className="stats results-stats">
        <div><strong>{rows.filter((r) => r.place === 1).map((r) => r.name).join(', ')}</strong><span>víťaz · {fmt(rows[0].total)} b.</span></div>
        <div><strong>{rows.length}</strong><span>tímov</span></div>
        <div><strong>{fmt(Math.round(avgTotal * 10) / 10)}</strong><span>priemer z {maxTotal} b.</span></div>
        {hardest && <div><strong>{hardest.icon} {hardest.name}</strong><span>najťažšia téma · {pct(hardest.avg, hardest.max)} %</span></div>}
        {easiest && easiest !== hardest && <div><strong>{easiest.icon} {easiest.name}</strong><span>najľahšia téma · {pct(easiest.avg, easiest.max)} %</span></div>}
      </div>

      <div className="board-card">
        <p className="muted small">Ťuknite na tím pre detail tém.</p>
        <div className="table-wrap">
          <table className="board results-board">
            <thead><tr><th></th><th>Tím</th>{published.map((_, i) => <th key={i}>{i + 1}.</th>)}<th>Spolu</th></tr></thead>
            <tbody>
              {rows.map((r) => (
                <RowWithDetail key={r.id} open={open === r.id} onToggle={() => setOpen(open === r.id ? undefined : r.id)} cols={published.length + 3}
                  row={<>
                    <td className="place">{medal(r.place)}</td>
                    <td className="team">{r.name}</td>
                    {r.perRound.map((p, i) => <td key={i} className="num">{fmt(p)}</td>)}
                    <td className="num total">{fmt(r.total)}</td>
                  </>}
                  className={r.place <= 3 ? `top top${r.place}` : ''}
                  detail={<TeamTopics topics={r.topics} perRound={r.perRound} />} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <h2 className="section-title">Víťazi kôl</h2>
      <div className="tiles">
        {roundWinners.map((w) => (
          <div key={w.name} className="tile">
            <span className="tile-label">{w.name}</span>
            {w.teams.map((t) => <strong key={t}>{t}</strong>)}
            <span className="tile-score">{fmt(w.score)} b.</span>
          </div>
        ))}
      </div>

      {topicStats.length > 0 && <>
        <h2 className="section-title">Témy</h2>
        <div className="topic-grid">
          {topicStats.map((t) => (
            <div key={t.key} className="topic-card">
              <div className="topic-head"><span>{t.icon} {t.name}</span><span className="muted small">{t.round}. kolo</span></div>
              {t.cat && <div className="muted small topic-cat-name">{t.cat}</div>}
              <Bar value={pct(t.avg, t.max)} />
              <div className="muted small">Priemer {fmt(Math.round(t.avg * 10) / 10)} / {t.max} · {pct(t.avg, t.max)} %</div>
              {t.winners.length > 0 && <div className="topic-best">🏆 {t.winners.length > 3 ? `${t.winners.length} tímov` : t.winners.join(', ')} ({fmt(t.best)})</div>}
            </div>
          ))}
        </div>
      </>}
    </>
  )
}

function RowWithDetail({ row, detail, open, onToggle, cols, className }: { row: React.ReactNode; detail: React.ReactNode; open: boolean; onToggle: () => void; cols: number; className: string }) {
  return (
    <>
      <tr className={`clickable ${className} ${open ? 'open' : ''}`} onClick={onToggle} tabIndex={0} onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && (e.preventDefault(), onToggle())} aria-expanded={open}>{row}</tr>
      {open && <tr className="detail-row"><td colSpan={cols}>{detail}</td></tr>}
    </>
  )
}

function Bar({ value }: { value: number }) {
  return <div className="bar"><span style={{ width: `${Math.min(100, value)}%` }} /></div>
}

function BestWorst({ items }: { items: { name: string; icon: string; score: number; max: number }[] }) {
  const withMax = items.filter((t) => t.max > 0)
  if (!withMax.length) return null
  const p = (t: { score: number; max: number }) => pct(t.score, t.max)
  const best = Math.max(...withMax.map(p)), worst = Math.min(...withMax.map(p))
  const list = (v: number) => withMax.filter((t) => p(t) === v).map((t) => `${t.icon} ${t.name}`.trim()).join(', ')
  return (
    <div className="best-worst">
      <span>📈 Najlepšie: <strong>{list(best)}</strong> ({best} %)</span>
      {worst !== best && <span>📉 Najslabšie: <strong>{list(worst)}</strong> ({worst} %)</span>}
    </div>
  )
}

function TeamTopics({ topics, perRound }: { topics: TeamRow['topics']; perRound: number[] }) {
  if (!topics.length) return <p className="muted small">K tomuto kvízu nie sú body po témach.</p>
  return (
    <div className="team-detail">
      {perRound.map((sum, i) => (
        <div key={i} className="team-detail-round">
          <span className="muted">{i + 1}. kolo</span>
          {topics.filter((t) => t.round === i + 1).map((t, j) => <span key={j} className="chip">{t.icon} {t.name} <b>{fmt(t.score)}/{t.max}</b></span>)}
          <span className="round-sum">= {fmt(sum)} b.</span>
        </div>
      ))}
      <BestWorst items={topics} />
    </div>
  )
}

// ---------------------------------------------------------------- liga (sezóna)

function League({ quizzes, cats }: { quizzes: Quiz[]; cats: Map<string, Cat> }) {
  const [data, setData] = useState<QuizData>()
  const [open, setOpen] = useState<string>()
  useEffect(() => {
    if (!quizzes.length) { setData({ teams: [], rounds: [], topics: [], ts: [], rs: [] }); return }
    loadQuizzes(quizzes.map((q) => q.id)).then(setData).catch(() => setData({ teams: [], rounds: [], topics: [], ts: [], rs: [] }))
  }, [quizzes])

  const calc = useMemo(() => {
    if (!data) return null
    const teamById = new Map(data.teams.map((t) => [t.id, t]))
    const roundQuiz = new Map(data.rounds.map((r) => [r.id, r.quiz_id]))
    const topicById = new Map(data.topics.map((t) => [t.id, t]))
    type Agg = { names: Map<string, number>; quizTotals: Map<string, number>; cats: Map<string, { icon: string; score: number; max: number }> }
    const agg = new Map<string, Agg>()
    const leagueCats = new Map<string, { icon: string; score: number; max: number; teams: Map<string, number> }>()
    const quizTitle = new Map(quizzes.map((q) => [q.id, q.title.replace(/\.\d{4}.*$/, '.')]))
    const catTopics = new Map<string, Set<string>>()
    for (const t of data.topics) {
      if (!t.name) continue
      const cn = cats.get(t.category_id ?? '')?.name ?? 'Ostatné'
      if (!catTopics.has(cn)) catTopics.set(cn, new Set())
      catTopics.get(cn)!.add(`${t.name} (${quizTitle.get(roundQuiz.get(t.round_id) ?? '') ?? ''})`)
    }
    const covered = new Set<string>()
    const entry = (team: Team) => {
      const k = norm(team.name) || team.name
      if (!agg.has(k)) agg.set(k, { names: new Map(), quizTotals: new Map(), cats: new Map() })
      const a = agg.get(k)!
      a.names.set(team.name.trim(), (a.names.get(team.name.trim()) ?? 0) + 1)
      return { k, a }
    }
    for (const s of data.ts) {
      const team = teamById.get(s.team_id), t = topicById.get(s.round_topic_id)
      if (!team || !t) continue
      const v = Math.max(0, Number(s.score)), qid = roundQuiz.get(t.round_id)!
      const { k, a } = entry(team)
      a.quizTotals.set(qid, (a.quizTotals.get(qid) ?? 0) + v)
      covered.add(team.id + '|' + t.round_id)
      const cat = cats.get(t.category_id ?? '')
      const cn = cat?.name ?? 'Ostatné', icon = cat?.icon ?? '', max = t.max_points ?? 5
      const c = a.cats.get(cn) ?? { icon, score: 0, max: 0 }; c.score += v; c.max += max; a.cats.set(cn, c)
      const lc = leagueCats.get(cn) ?? { icon, score: 0, max: 0, teams: new Map() }; lc.score += v; lc.max += max; lc.teams.set(k, (lc.teams.get(k) ?? 0) + v); leagueCats.set(cn, lc)
    }
    for (const s of data.rs) {
      const team = teamById.get(s.team_id)
      if (!team || covered.has(s.team_id + '|' + s.round_id)) continue
      const qid = roundQuiz.get(s.round_id)!
      const { a } = entry(team)
      a.quizTotals.set(qid, (a.quizTotals.get(qid) ?? 0) + Math.max(0, Number(s.score)))
    }
    const order = quizzes.map((q) => q.id) // od najnovšieho
    const displayName = (a: Agg) => [...a.names.entries()].sort((x, y) => y[1] - x[1])[0][0]
    const rows = rankRows([...agg.entries()].map(([k, a]) => {
      const byDate = order.filter((id) => a.quizTotals.has(id)).map((id) => a.quizTotals.get(id)!)
      let form: 'up' | 'down' | 'same' | null = null
      if (byDate.length >= 2) {
        const prevAvg = byDate.slice(1).reduce((x, y) => x + y, 0) / (byDate.length - 1)
        form = byDate[0] > prevAvg * 1.05 ? 'up' : byDate[0] < prevAvg * 0.95 ? 'down' : 'same'
      }
      return { key: k, name: displayName(a), total: [...a.quizTotals.values()].reduce((x, y) => x + y, 0), played: a.quizTotals.size, form, cats: a.cats }
    }))
    const nameOf = new Map(rows.map((r) => [r.key, r.name]))
    const catStats = [...leagueCats.entries()].map(([name, c]) => {
      const best = Math.max(0, ...c.teams.values())
      const n = Math.max(1, c.teams.size)
      return { name, icon: c.icon, avg: c.score / n, avgMax: c.max / n, p: pct(c.score, c.max), best, winners: [...c.teams.entries()].filter(([, v]) => v === best && best > 0).map(([k]) => nameOf.get(k) ?? k) }
    }).sort((a, b) => b.p - a.p)
    return { rows, catStats, catTopics }
  }, [data, cats, quizzes])

  if (!calc) return <Spinner />
  if (!calc.rows.length) return <p className="card center">V tejto sezóne zatiaľ nie sú žiadne výsledky.</p>
  const hasForm = calc.rows.some((r) => r.form)
  const formIcon = { up: '▲', down: '▼', same: '–' } as const

  return (
    <>
      <div className="board-card">
        <p className="muted small">Súčet bodov za sezónu · {quizzes.length} {quizzes.length === 1 ? 'kvíz' : quizzes.length < 5 ? 'kvízy' : 'kvízov'} · ťuknite na tím pre jeho silné a slabé témy</p>
        <div className="table-wrap">
          <table className="board results-board">
            <thead><tr><th></th><th>Tím</th><th>Účasti</th>{hasForm && <th>Forma</th>}<th>Spolu</th></tr></thead>
            <tbody>
              {calc.rows.map((r) => {
                const items = [...r.cats.entries()].map(([name, c]) => ({ name, icon: c.icon, score: c.score, max: c.max })).sort((a, b) => pct(b.score, b.max) - pct(a.score, a.max))
                return (
                  <RowWithDetail key={r.key} open={open === r.key} onToggle={() => setOpen(open === r.key ? undefined : r.key)} cols={hasForm ? 5 : 4}
                    className={r.place <= 3 ? `top top${r.place}` : ''}
                    row={<>
                      <td className="place">{medal(r.place)}</td>
                      <td className="team">{r.name}</td>
                      <td className="num">{r.played}</td>
                      {hasForm && <td className={`num form-${r.form ?? 'none'}`} title={r.form === 'up' ? 'stúpajúca forma' : r.form === 'down' ? 'klesajúca forma' : r.form ? 'stabilná forma' : ''}>{r.form ? formIcon[r.form] : ''}</td>}
                      <td className="num total">{fmt(r.total)}</td>
                    </>}
                    detail={items.length ? (
                      <div className="team-detail">
                        {items.map((c) => (
                          <div key={c.name} className="cat-line"><Tip text={tipText(calc.catTopics, c.name)}>{c.icon} {c.name}</Tip><Bar value={pct(c.score, c.max)} /><span className="muted small">{fmt(c.score)}/{c.max} · {pct(c.score, c.max)} %</span></div>
                        ))}
                        <BestWorst items={items} />
                      </div>
                    ) : <p className="muted small">Body sú zo starších kvízov bez tém.</p>} />
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      {calc.catStats.length > 0 && <>
        <h2 className="section-title">Kategórie v sezóne</h2>
        <div className="topic-grid">
          {calc.catStats.map((c) => (
            <div key={c.name} className="topic-card">
              <div className="topic-head"><Tip text={tipText(calc.catTopics, c.name)}>{c.icon} {c.name}</Tip><span className="muted small">{c.p} %</span></div>
              <Bar value={c.p} />
              <div className="muted small">Priemer na tím {fmt(Math.round(c.avg * 10) / 10)} / {fmt(Math.round(c.avgMax * 10) / 10)}</div>
              {c.winners.length > 0 && <div className="topic-best">🏆 {c.winners.length > 3 ? `${c.winners.length} tímov` : c.winners.join(', ')} ({fmt(c.best)})</div>}
            </div>
          ))}
        </div>
      </>}
    </>
  )
}

const tipText = (m: Map<string, Set<string>>, cat: string) => [...(m.get(cat) ?? [])].join('\n')

// jemná bublina s témami kategórie – myšou aj ťuknutím (focus)
function Tip({ text, children }: { text: string; children: React.ReactNode }) {
  if (!text) return <span>{children}</span>
  return <span className="tip" tabIndex={0} data-tip={text} onClick={(e) => e.stopPropagation()}>{children}</span>
}
