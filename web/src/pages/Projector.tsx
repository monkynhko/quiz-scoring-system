import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components'

// Priebežné poradie aktuálneho kvízu – iba zverejnené kolá (databáza nezverejnené body verejnosti nevydá).
// /projektor = veľké písmo na plátno, /live = pre mobily.

type Row = { team: string; perRound: (number | null)[]; total: number }

const fmt = (n: number | null) => (n == null ? '' : Number.isInteger(n) ? String(n) : String(n).replace('.5', '½'))

export default function Projector({ big = true }: { big?: boolean }) {
  const [params] = useSearchParams()
  const [title, setTitle] = useState<string>()
  const [rounds, setRounds] = useState<{ id: string; name: string }[]>([])
  const [rows, setRows] = useState<Row[]>()
  const [updated, setUpdated] = useState<Date>()

  const load = useCallback(async () => {
    let quizId = params.get('kviz')
    if (!quizId) {
      const { data } = await supabase.from('quizzes').select('id').gt('created_at', '2001-01-01').order('created_at', { ascending: false }).limit(1)
      quizId = data?.[0]?.id ?? null
    }
    if (!quizId) { setRows([]); return }
    const [q, t, r] = await Promise.all([
      supabase.from('quizzes').select('title').eq('id', quizId).single(),
      supabase.from('teams').select('id, name').eq('quiz_id', quizId),
      supabase.from('rounds').select('id, name, round_order, published_at').eq('quiz_id', quizId).order('round_order'),
    ])
    const published = ((r.data ?? []) as { id: string; name: string; published_at: string | null }[]).filter((x) => x.published_at)
    const { data: sc } = published.length
      ? await supabase.from('scores').select('team_id, round_id, score').in('round_id', published.map((x) => x.id))
      : { data: [] }
    const byTeam = new Map<string, Map<string, number>>()
    for (const s of (sc ?? []) as { team_id: string; round_id: string; score: number }[]) {
      if (!byTeam.has(s.team_id)) byTeam.set(s.team_id, new Map())
      byTeam.get(s.team_id)!.set(s.round_id, Number(s.score))
    }
    const list = ((t.data ?? []) as { id: string; name: string }[]).map((team) => {
      const m = byTeam.get(team.id)
      const perRound = published.map((rd) => m?.get(rd.id) ?? null)
      return { team: team.name, perRound, total: perRound.reduce<number>((a, b) => a + (b ?? 0), 0) }
    }).sort((a, b) => b.total - a.total || a.team.localeCompare(b.team, 'sk'))
    setTitle(q.data?.title)
    setRounds(published)
    setRows(list)
    setUpdated(new Date())
  }, [params])

  useEffect(() => {
    load()
    const t = setInterval(load, 8000)
    const ch = supabase.channel('projector').on('postgres_changes', { event: 'UPDATE', schema: 'public', table: 'rounds' }, () => load()).subscribe()
    return () => { clearInterval(t); supabase.removeChannel(ch) }
  }, [load])

  if (!rows) return <Spinner />
  // poradie s delenými miestami
  let place = 0, prev = -1
  const ranked = rows.map((r, i) => { if (r.total !== prev) { place = i + 1; prev = r.total } return { ...r, place } })

  return (
    <div className={`projector ${big ? 'big' : ''}`}>
      <div className="projector-head">
        <h1>{title ? `Priebežné poradie · ${title}` : 'Priebežné poradie'}</h1>
        {big && <button className="button button-small button-ghost" onClick={() => document.documentElement.requestFullscreen?.()}>Celá obrazovka</button>}
      </div>
      {rounds.length === 0 ? <p className="lead center">Výsledky zatiaľ neboli zverejnené.</p> : (
        <table className="board">
          <thead><tr><th></th><th>Tím</th>{rounds.map((r) => <th key={r.id}>{r.name}.</th>)}<th>Spolu</th></tr></thead>
          <tbody>
            {ranked.map((r) => (
              <tr key={r.team} className={r.place <= 3 ? `top top${r.place}` : ''}>
                <td className="place">{r.place <= 3 ? ['🥇', '🥈', '🥉'][r.place - 1] : `${r.place}.`}</td>
                <td className="team">{r.team}</td>
                {r.perRound.map((p, i) => <td key={i} className="num">{fmt(p)}</td>)}
                <td className="num total">{fmt(r.total)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {!big && updated && <p className="muted small center">Obnovuje sa automaticky</p>}
    </div>
  )
}
