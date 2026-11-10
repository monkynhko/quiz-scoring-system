import { useCallback, useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { roundLabel } from '../lib/format'
import { supabase } from '../lib/supabase'
import { Spinner } from '../components'

// Verejná obrazovka pre plátno: kto už odovzdal hárok a koľko času zostáva. Žiadne fotky ani body – iba názvy tímov a áno/nie.
// Dotaz je jeden malý RPC raz za 3 s (1 projektor = zanedbateľná záťaž).

type Progress = { quiz_title: string; round_name: string; open: boolean; closes_at: string; now: string; teams: { name: string; sent: boolean }[] }

export default function SubmitBoard() {
  const [params] = useSearchParams()
  const [data, setData] = useState<Progress | null>()
  const [tick, setTick] = useState(Date.now())
  const offset = useRef(0)   // rozdiel hodín server − zariadenie

  const load = useCallback(async () => {
    const { data: d } = await supabase.rpc('submit_progress', { p_quiz_id: params.get('kviz') })
    if (d) { offset.current = new Date((d as Progress).now).getTime() - Date.now(); setData(d as Progress) }
    else setData((cur) => cur ?? null)
  }, [params])
  useEffect(() => {
    load()
    const t = setInterval(load, 3000)
    const c = setInterval(() => setTick(Date.now()), 250)
    return () => { clearInterval(t); clearInterval(c) }
  }, [load])

  if (data === undefined) return <Spinner />
  if (data === null) return <div className="submit-board"><p className="lead center">Odovzdávanie hárkov zatiaľ nebolo otvorené.</p></div>

  const left = Math.max(0, Math.ceil((new Date(data.closes_at).getTime() - (tick + offset.current)) / 1000))
  const open = data.open && left > 0
  const sent = data.teams.filter((t) => t.sent).length
  const total = data.teams.length
  const all = total > 0 && sent === total
  return (
    <div className="submit-board">
      <div className="submit-board-head">
        <div>
          <h1>Odovzdávanie hárkov · {roundLabel(data.round_name)}</h1>
          <p className="muted">kvizfactory.sk/odovzdat</p>
        </div>
        <div className={`sb-clock ${open ? (left <= 30 ? 'low' : '') : 'closed'}`}>
          {open ? `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}` : all ? 'Hotovo' : 'Zatvorené'}
        </div>
      </div>
      <p className="sb-count"><strong>{sent}</strong> / {total} odovzdali{!all && open ? ` · čakáme na ${total - sent}` : ''}</p>
      <div className="sb-grid">
        {data.teams.map((t) => (
          <div key={t.name} className={`sb-team ${t.sent ? 'sent' : ''}`}>
            <span className="sb-mark">{t.sent ? '✓' : '…'}</span>
            <span className="sb-name">{t.name}</span>
          </div>
        ))}
      </div>
    </div>
  )
}
