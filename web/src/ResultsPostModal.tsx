import { useEffect, useRef, useState } from 'react'
import { supabase, type PublicEvent } from './lib/supabase'
import { dateLong, time } from './lib/format'
import { drawResultsImage, type ResultRow } from './lib/socialImage'

// Príspevok s výsledkami kvízu (pódium + 4.–10. miesto). Nič sa nezverejní bez kliknutia na „Zverejniť“.
type Quiz = { id: string; title: string; event_id: string | null }

const pts = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.5', '½'))
const prettyDate = (title: string) => title.replace(/^(\d{1,2})\.(\d{1,2})\.(\d{4})$/, (_, d, m, y) => `${+d}. ${+m}. ${y}`)

export function ResultsPostModal({ quiz, onClose }: { quiz: Quiz; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [rows, setRows] = useState<ResultRow[]>()
  const [next, setNext] = useState<PublicEvent | null>(null)
  const [caption, setCaption] = useState('')
  const [fb, setFb] = useState(true)
  const [ig, setIg] = useState(true)
  const [state, setState] = useState<'idle' | 'publishing' | 'done'>('idle')
  const [result, setResult] = useState<string>()
  const title = `VÝSLEDKY · ${prettyDate(quiz.title)}`

  useEffect(() => {
    (async () => {
      const [{ data: teams }, { data: rounds }, ev] = await Promise.all([
        supabase.from('teams').select('id, name').eq('quiz_id', quiz.id),
        supabase.from('rounds').select('id').eq('quiz_id', quiz.id),
        supabase.rpc('public_events'),
      ])
      const { data: sc } = await supabase.from('scores').select('team_id, score').in('round_id', (rounds ?? []).map((r) => r.id))
      const tot = new Map<string, number>()
      for (const s of sc ?? []) tot.set(s.team_id, (tot.get(s.team_id) ?? 0) + Number(s.score))
      const list = (teams ?? []).filter((t) => tot.has(t.id)).map((t) => ({ team: t.name, total: tot.get(t.id)! }))
        .sort((a, b) => b.total - a.total || a.team.localeCompare(b.team, 'sk'))
      let place = 0, prev = NaN
      const ranked = list.map((r, i) => { if (r.total !== prev) { place = i + 1; prev = r.total } return { ...r, place } })
      const upcoming = ((ev.data ?? []) as PublicEvent[]).find((e) => new Date(e.starts_at) > new Date()) ?? null
      setRows(ranked); setNext(upcoming)
      const medals = ['🥇', '🥈', '🥉']
      setCaption(`🏆 Výsledky Kvíz Factory · ${prettyDate(quiz.title)}

${ranked.slice(0, 3).map((r) => `${medals[r.place - 1] ?? `${r.place}.`} ${r.team} – ${pts(r.total)} b.`).join('\n')}

Gratulujeme víťazom a ďakujeme všetkým ${ranked.length} tímom za skvelý večer! 🧠
Celé poradie a štatistiky tém nájdete na kvizfactory.sk/vysledky
${upcoming ? `\n📅 Ďalší kvíz: ${dateLong(upcoming.starts_at)} o ${time(upcoming.starts_at)} · ${upcoming.venue}${upcoming.registration_open ? ' – registrácia je otvorená na kvizfactory.sk' : ''}\n` : ''}
#kvizfactory #pubkviz #kviz`)
    })()
  }, [quiz.id, quiz.title])

  useEffect(() => {
    if (canvas.current && rows) drawResultsImage(canvas.current, { title, rows, teams: rows.length, footer: `Ďakujeme všetkým ${rows.length} tímom! · kvizfactory.sk` })
  }, [rows, title])

  const toBlob = () => new Promise<Blob>((res) => canvas.current!.toBlob((b) => res(b!), 'image/jpeg', 0.9))
  async function download() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await toBlob()); a.download = `kvizfactory-vysledky-${quiz.title}.jpg`; a.click()
  }
  async function publish() {
    const where = [fb && 'Facebook', ig && 'Instagram'].filter(Boolean).join(' a ')
    if (!where || !confirm(`Zverejniť výsledky na ${where}? Na Instagrame sa príspevok nedá upraviť, iba zmazať.`)) return
    setState('publishing'); setResult(undefined)
    const path = `posts/vysledky-${quiz.title.replace(/\W+/g, '-')}-${Date.now()}.jpg`
    const up = await supabase.storage.from('social').upload(path, await toBlob(), { contentType: 'image/jpeg' })
    if (up.error) { setResult('Nahratie obrázka zlyhalo: ' + up.error.message); setState('idle'); return }
    const { data, error } = await supabase.functions.invoke('publish-social', {
      body: { event_id: quiz.event_id, caption, image_path: path, targets: [fb && 'fb', ig && 'ig'].filter(Boolean) },
    })
    if (error) { setResult('Zverejnenie zlyhalo: ' + error.message); setState('idle'); return }
    const r = data as { status: string; errors: string[] }
    setResult(r.status === 'published' ? `✅ Zverejnené na ${where}.` : `⚠ ${r.status === 'partial' ? 'Zverejnené iba čiastočne' : 'Nezverejnené'}: ${r.errors.join(' · ')}`)
    setState(r.status === 'failed' ? 'idle' : 'done')
  }

  return (
    <div className="modal-overlay">
      <div className="modal social-modal">
        <div className="modal-head">
          <strong>🏆 Výsledky na Facebook a Instagram</strong>
          <button className="button button-small button-ghost" onClick={onClose}>{state === 'done' ? 'Zavrieť' : 'Teraz nie'}</button>
        </div>
        <div className="social-body">
          <canvas ref={canvas} className="social-canvas" />
          <div className="form">
            {!rows && <p className="muted">Načítavam výsledky…</p>}
            {rows && rows.length < 3 && <p className="alert">Kvíz ešte nemá body aspoň troch tímov.</p>}
            {next === null && rows && <p className="hint">Nenašiel sa žiadny ďalší verejný kvíz – v texte nie je pozvánka.</p>}
            <label>Text príspevku
              <textarea rows={14} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </label>
            <div className="cta-row">
              <label className="checkbox-row"><input type="checkbox" checked={fb} onChange={(e) => setFb(e.target.checked)} /> <span>Facebook</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={ig} onChange={(e) => setIg(e.target.checked)} /> <span>Instagram</span></label>
            </div>
            {result && <p className={result.startsWith('✅') ? 'success' : 'alert'}>{result}</p>}
            <div className="cta-row">
              <button className="button" disabled={state !== 'idle' || (!fb && !ig) || !rows || rows.length < 3} onClick={publish}>
                {state === 'publishing' ? 'Zverejňujem…' : state === 'done' ? 'Zverejnené ✓' : 'Zverejniť'}
              </button>
              <button className="button button-ghost" disabled={!rows} onClick={download}>Stiahnuť obrázok</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
