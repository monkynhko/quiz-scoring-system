import { useEffect, useRef, useState } from 'react'
import { supabase } from './lib/supabase'
import { dateLong, time } from './lib/format'
import { drawSocialImage } from './lib/socialImage'

// Náhľad príspevku na FB + IG pri otvorení registrácie. Nič sa nezverejní bez kliknutia na „Zverejniť“.
type Ev = { id: string; slug: string; title: string; starts_at: string; venue: string }

const weekdayDate = (iso: string) => {
  const d = new Date(iso)
  const wd = new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', weekday: 'long' }).format(d)
  const dm = new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', day: 'numeric', month: 'numeric' }).format(d)
  return { wd, dm: dm.replace(/\s/g, ' ') }
}

export function defaultCaption(e: Ev) {
  return `🧠 Registrácia na Kvíz Factory je otvorená!

📅 ${dateLong(e.starts_at)} o ${time(e.starts_at)}
📍 ${e.venue}
👥 Tímy po 4 – 6 ľuďoch

👉 Prihláste svoj tím na kvizfactory.sk

#kvizfactory #pubkviz #kviz`
}

export function SocialPostModal({ event, onClose }: { event: Ev; onClose: () => void }) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const { wd, dm } = weekdayDate(event.starts_at)
  const [headline, setHeadline] = useState('REGISTRÁCIA OTVORENÁ')
  const [caption, setCaption] = useState(defaultCaption(event))
  const [fb, setFb] = useState(true)
  const [ig, setIg] = useState(true)
  const [state, setState] = useState<'idle' | 'publishing' | 'done'>('idle')
  const [result, setResult] = useState<string>()

  useEffect(() => {
    if (canvas.current) drawSocialImage(canvas.current, { headline, dateLine: `${wd.toUpperCase()} ${dm}`, timeVenue: `${time(event.starts_at)} · ${event.venue}`, footer: 'kvizfactory.sk' })
  }, [headline, wd, dm, event.starts_at, event.venue])

  const toBlob = () => new Promise<Blob>((res) => canvas.current!.toBlob((b) => res(b!), 'image/jpeg', 0.9))

  async function download() {
    const a = document.createElement('a')
    a.href = URL.createObjectURL(await toBlob())
    a.download = `kvizfactory-${event.slug}.jpg`
    a.click()
  }

  async function publish() {
    const where = [fb && 'Facebook', ig && 'Instagram'].filter(Boolean).join(' a ')
    if (!where) return
    if (!confirm(`Zverejniť príspevok na ${where}? Na Instagrame sa príspevok nedá upraviť, iba zmazať.`)) return
    setState('publishing'); setResult(undefined)
    const path = `posts/${event.slug}-${Date.now()}.jpg`
    const up = await supabase.storage.from('social').upload(path, await toBlob(), { contentType: 'image/jpeg' })
    if (up.error) { setResult('Nahratie obrázka zlyhalo: ' + up.error.message); setState('idle'); return }
    const { data, error } = await supabase.functions.invoke('publish-social', {
      body: { event_id: event.id, caption, image_path: path, targets: [fb && 'fb', ig && 'ig'].filter(Boolean) },
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
          <strong>📣 Príspevok na Facebook a Instagram</strong>
          <button className="button button-small button-ghost" onClick={onClose}>{state === 'done' ? 'Zavrieť' : 'Teraz nie'}</button>
        </div>
        <div className="social-body">
          <canvas ref={canvas} className="social-canvas" />
          <div className="form">
            <label>Nadpis na obrázku
              <select value={headline} onChange={(e) => setHeadline(e.target.value)}>
                {['REGISTRÁCIA OTVORENÁ', 'POSLEDNÉ VOĽNÉ MIESTA', 'UŽ ČOSKORO', 'KVÍZ SA BLÍŽI'].map((h) => <option key={h}>{h}</option>)}
              </select>
            </label>
            <label>Text príspevku
              <textarea rows={11} value={caption} onChange={(e) => setCaption(e.target.value)} />
            </label>
            <div className="cta-row">
              <label className="checkbox-row"><input type="checkbox" checked={fb} onChange={(e) => setFb(e.target.checked)} /> <span>Facebook</span></label>
              <label className="checkbox-row"><input type="checkbox" checked={ig} onChange={(e) => setIg(e.target.checked)} /> <span>Instagram</span></label>
            </div>
            {result && <p className={result.startsWith('✅') ? 'success' : 'alert'}>{result}</p>}
            <div className="cta-row">
              <button className="button" disabled={state !== 'idle' || (!fb && !ig)} onClick={publish}>
                {state === 'publishing' ? 'Zverejňujem…' : state === 'done' ? 'Zverejnené ✓' : 'Zverejniť'}
              </button>
              <button className="button button-ghost" onClick={download}>Stiahnuť obrázok</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
