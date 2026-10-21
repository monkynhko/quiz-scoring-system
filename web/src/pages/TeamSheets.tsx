import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { Spinner, QR } from '../components'
import { time, roundLabel, roundOf } from '../lib/format'

// „Naše hárky“ – opravené hárky tímu, iba na čítanie. Kolo sa ukáže až po zverejnení na projektore.

type Answer = { n: number; written: string; correct: string; points: number | null }
type RoundView = {
  id: string; name: string; order: number; kind?: 'sheet' | 'manual'; submitted: boolean; submitted_at: string | null; published: boolean
  photo?: string | null; answers?: Answer[]; score?: number | null; topics?: { order: number; name: string; max: number; score: number | null }[]
}
type Data = { team: string; quiz: string; total: number; rounds: RoundView[] }

const fmt = (p: number | null | undefined) => (p == null ? '–' : Number.isInteger(Number(p)) ? String(Number(p)) : String(Number(p)).replace('.5', '½').replace(/^0½$/, '½'))

export default function TeamSheets() {
  const { token } = useParams()
  const [data, setData] = useState<Data | null>()
  const [open, setOpen] = useState<string>()
  const [zoom, setZoom] = useState<string>()
  const [share, setShare] = useState(false)

  const load = useCallback(async () => {
    const { data, error } = await supabase.functions.invoke('team-sheets', { body: { token } })
    if (error) { setData((d) => (d === undefined ? null : d)); return }
    setData(data as Data)
  }, [token])

  useEffect(() => {
    load()
    const t = setInterval(load, 20000) // nové zverejnené kolá a opravy sa ukážu samy
    return () => clearInterval(t)
  }, [load])

  // naposledy zverejnené kolo otvoríme automaticky
  useEffect(() => {
    if (!data || open !== undefined) return
    const last = [...data.rounds].reverse().find((r) => r.published && r.submitted && r.kind !== 'manual')
    if (last) setOpen(last.id)
  }, [data, open])

  if (data === undefined) return <Spinner />
  if (data === null) return <p className="card center">Odkaz na hárky tímu sa nenašiel. Skontrolujte, či ste ho skopírovali celý.</p>

  const url = location.href
  async function shareLink() {
    if (navigator.share) { try { await navigator.share({ title: `${data!.team} – naše hárky`, url }); return } catch { /* zrušené */ } }
    setShare((s) => !s)
  }

  return (
    <div className="team-sheets">
      <section className="hero">
        <h1>{data.team}</h1>
        <p className="lead">Kvíz {data.quiz} · zverejnené kolá spolu <strong className="hl">{fmt(data.total)} b.</strong></p>
        <div className="cta-row center-row">
          <button className="button button-small button-ghost" onClick={shareLink}>📤 Zdieľať s tímom</button>
          <a className="button button-small button-ghost" href="/live">📊 Priebežné poradie</a>
        </div>
        {share && (
          <div className="share-box">
            <QR value={url} size={180} label="Odkaz na hárky tímu" />
            <p className="muted small">Nech si ostatní pri stole naskenujú tento kód.</p>
            <button className="link small" onClick={() => navigator.clipboard?.writeText(url)}>Skopírovať odkaz</button>
          </div>
        )}
      </section>

      <div className="sheet-rounds">
        {data.rounds.map((r) => (
          <article key={r.id} className={`card sheet-round ${r.published ? '' : 'waiting'}`}>
            {r.kind === 'manual' ? (
              <div className="sheet-round-head">
                <span className="sheet-round-name">{roundLabel(r.name)}</span>
                <span className="sheet-round-state">{r.published ? <strong>{fmt(r.score)} b.</strong> : 'čaká na zverejnenie'}</span>
              </div>
            ) : (
            <button className="sheet-round-head" disabled={!r.published || !r.submitted} onClick={() => setOpen(open === r.id ? '' : r.id)} aria-expanded={open === r.id}>
              <span className="sheet-round-name">{roundLabel(r.name)}</span>
              <span className="sheet-round-state">
                {!r.submitted ? (r.published ? 'neodovzdané' : '–')
                  : !r.published ? `odovzdané ${r.submitted_at ? time(r.submitted_at) : ''} · čaká na zverejnenie`
                  : <><strong>{fmt(r.score)} b.</strong> {open === r.id ? '▲' : '▼'}</>}
              </span>
            </button>
            )}
            {r.published && r.submitted && open === r.id && (
              <div className="sheet-body readonly">
                {r.photo && <button className="sheet-photo" onClick={() => setZoom(r.photo!)}><img src={r.photo} alt={`Hárok ${roundOf(r.name)}`} loading="lazy" /></button>}
                <div>
                  {r.topics?.map((t) => (
                    <div key={t.order} className="sheet-topic">
                      <h3><span>{t.name}</span><span className="topic-pts">{fmt(t.score)} / {t.max}</span></h3>
                      <table className="sheet-answers">
                        <tbody>
                          {(r.answers ?? []).filter((a) => Math.ceil(a.n / 5) === t.order).map((a) => (
                            <tr key={a.n} className={a.points === 1 ? 'ok' : a.points ? 'half' : 'bad'}>
                              <td className="qn">{a.n}</td>
                              <td>
                                <div className="written">{a.written.replace(/\s*\(prečiarknuté:[^)]*\)/gi, '').trim() || <span className="muted">(nič)</span>}</div>
                                {a.points !== 1 && <div className="correct">✓ {a.correct}</div>}
                              </td>
                              <td className="pts"><span className="pt">{fmt(a.points)}</span></td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ))}
                  <p className="muted small sheet-note">V prípade omylu, prosím, príďte počas prestávky na centrálu.</p>
                </div>
              </div>
            )}
          </article>
        ))}
      </div>
      <p className="muted small center">Stránka sa obnovuje sama – nové kolá sa ukážu po zverejnení výsledkov.</p>
      {zoom && <div className="modal-overlay" onClick={() => setZoom(undefined)}><img className="zoom-photo" src={zoom} alt="Hárok" /></div>}
    </div>
  )
}
