import { useCallback, useEffect, useRef, useState } from 'react'
import { supabase } from '../lib/supabase'
import { blobToDataUrl, compressPhoto, dataUrlToBlob } from '../lib/image'
import { Spinner } from '../components'

// Odovzdanie fotky odpoveďového hárku. Pri výpadku internetu sa fotka uloží v mobile a odošle sa sama.

type Window = { quiz_id: string; quiz_title: string; round_id: string; round_name: string; closes_at: string; allow_new_teams?: boolean; teams: { id: string; name: string }[] }
type Pending = { quiz_id: string; round_id: string; team_id: string; team_name: string; round_name: string; photo: string; at: number }
type Sent = { round_id: string; team_id: string; at: number }

const QUEUE_KEY = 'submit:queue'
const SENT_KEY = 'submit:sent'
const TEAM_KEY = 'submit:team'
const LINK_KEY = 'submit:links'   // team_id → tajný odkaz na „Naše hárky“
type Links = Record<string, string>
const read = <T,>(k: string, f: T): T => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : f } catch { return f } }
const write = (k: string, v: unknown) => { try { localStorage.setItem(k, JSON.stringify(v)) } catch { /* plné úložisko */ } }

export default function Submit() {
  const [win, setWin] = useState<Window | null>()
  const [teamId, setTeamId] = useState<string>(() => read(TEAM_KEY, ''))
  const [queue, setQueue] = useState<Pending[]>(() => read(QUEUE_KEY, []))
  const [sent, setSent] = useState<Sent[]>(() => read(SENT_KEY, []))
  const [links, setLinks] = useState<Links>(() => read(LINK_KEY, {}))
  const [preview, setPreview] = useState<{ blob: Blob; url: string }>()
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState<{ type: 'ok' | 'err' | 'wait'; text: string }>()
  const [now, setNow] = useState(Date.now())
  const fileInput = useRef<HTMLInputElement>(null)
  const queueRef = useRef(queue)
  queueRef.current = queue

  const poll = useCallback(async () => {
    const { data, error } = await supabase.rpc('current_submit_window')
    if (!error) setWin((data as Window | null) ?? null)
  }, [])

  // odoslanie čakajúcich fotiek (poradie zachované)
  const flushing = useRef(false)
  const flush = useCallback(async () => {
    if (flushing.current) return
    flushing.current = true
    try {
      while (queueRef.current.length) {
        const p = queueRef.current[0]
        const path = `${p.quiz_id}/${p.round_id}/${p.team_id}_${p.at}.jpg`
        const blob = await dataUrlToBlob(p.photo)
        const up = await supabase.storage.from('answer-sheets').upload(path, blob, { contentType: 'image/jpeg', upsert: false })
        // fotka už je nahratá z predchádzajúceho pokusu → pokračujeme odovzdaním
        if (up.error && !/exist|duplicate/i.test(up.error.message)) { setMsg({ type: 'wait', text: 'Slabý signál – fotku odošleme hneď, ako to pôjde. Nechajte stránku otvorenú.' }); break }
        const { data: subId, error } = await supabase.rpc('submit_sheet', { p_quiz_id: p.quiz_id, p_team_id: p.team_id, p_round_id: p.round_id, p_photo_path: path })
        if (!error && subId) {
          const { data: tok } = await supabase.rpc('team_token_for_submission', { p_submission_id: subId })
          if (tok) { const l = { ...read<Links>(LINK_KEY, {}), [p.team_id]: tok as string }; write(LINK_KEY, l); setLinks(l) }
        }
        if (error && /submit_closed/.test(error.message)) {
          setMsg({ type: 'err', text: `Odovzdávanie ${p.round_name}. kola už bolo zatvorené. Ukážte hárok moderátorovi.` })
        } else if (error) { setMsg({ type: 'wait', text: 'Slabý signál – skúšame znova…' }); break }
        else {
          const s = [...read<Sent[]>(SENT_KEY, []).filter((x) => !(x.round_id === p.round_id && x.team_id === p.team_id)), { round_id: p.round_id, team_id: p.team_id, at: Date.now() }]
          write(SENT_KEY, s); setSent(s)
          setMsg({ type: 'ok', text: `Hárok ${p.round_name}. kola za tím ${p.team_name} je odovzdaný ✓` })
        }
        const rest = queueRef.current.slice(1)
        queueRef.current = rest; write(QUEUE_KEY, rest); setQueue(rest)
      }
    } finally { flushing.current = false }
  }, [])

  useEffect(() => {
    poll(); flush()
    const t1 = setInterval(poll, 5000)
    const t2 = setInterval(flush, 5000)
    const t3 = setInterval(() => setNow(Date.now()), 1000)
    window.addEventListener('online', flush)
    return () => { clearInterval(t1); clearInterval(t2); clearInterval(t3); window.removeEventListener('online', flush) }
  }, [poll, flush])

  async function onFile(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0]
    e.target.value = ''
    if (!f) return
    setBusy(true)
    try {
      const blob = await compressPhoto(f)
      setPreview({ blob, url: URL.createObjectURL(blob) })
      setMsg(undefined)
    } catch { setMsg({ type: 'err', text: 'Fotku sa nepodarilo spracovať. Skúste ju odfotiť znova.' }) }
    setBusy(false)
  }

  async function send() {
    if (!win || !preview || !teamId) return
    const team = win.teams.find((t) => t.id === teamId)
    const item: Pending = { quiz_id: win.quiz_id, round_id: win.round_id, team_id: teamId, team_name: team?.name ?? '', round_name: win.round_name, photo: await blobToDataUrl(preview.blob), at: Date.now() }
    const q = [...queueRef.current.filter((x) => !(x.round_id === item.round_id && x.team_id === item.team_id)), item]
    queueRef.current = q; write(QUEUE_KEY, q); setQueue(q)
    setPreview(undefined)
    setMsg({ type: 'wait', text: 'Odosielam…' })
    flush()
  }

  if (win === undefined) return <Spinner />
  const pendingHere = queue.filter((p) => p.team_id === teamId)
  if (!win) return (
    <article className="card center">
      <h1>Odovzdanie hárku</h1>
      <p className="lead">🔒 Odovzdávanie je momentálne zatvorené.</p>
      <p className="muted">Počkajte na pokyn moderátora – stránka sa otvorí sama.</p>
      {pendingHere.length > 0 && <p className="alert">Čaká na odoslanie: {pendingHere.length} fotka. Nechajte stránku otvorenú.</p>}
      {msg && <p className={msg.type === 'ok' ? 'success' : 'alert'}>{msg.text}</p>}
      {teamId && links[teamId] && <TeamLink token={links[teamId]} />}
    </article>
  )

  const left = Math.max(0, Math.floor((new Date(win.closes_at).getTime() - now) / 1000))
  const team = win.teams.find((t) => t.id === teamId)
  const alreadySent = sent.find((s) => s.round_id === win.round_id && s.team_id === teamId)

  return (
    <article className="card submit-card">
      <p className="muted small" style={{ margin: 0 }}>{/^\d/.test(win.quiz_title) ? `Kvíz ${win.quiz_title}` : win.quiz_title}</p>
      <h1>{win.round_name}. kolo</h1>
      <p className="countdown">Do zatvorenia odovzdávania zostáva <strong>{Math.floor(left / 60)}:{String(left % 60).padStart(2, '0')}</strong></p>

      <label className="form">
        <span><strong>Váš tím</strong></span>
        <select value={teamId} onChange={(e) => { setTeamId(e.target.value); write(TEAM_KEY, e.target.value) }}>
          <option value="">– vyberte tím –</option>
          {win.teams.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          {win.allow_new_teams && <option value="__new">➕ Náš tím nie je v zozname</option>}
        </select>
      </label>
      {win.allow_new_teams && teamId === '__new' && <NewTeam quizId={win.quiz_id} onCreated={async (id) => { await poll(); setTeamId(id); write(TEAM_KEY, id) }} />}

      {team && (
        <>
          {alreadySent && !preview && <p className="success">Hárok za toto kolo je odovzdaný ✓ Ak ste sa pomýlili, pošlite novú fotku – nahradí predchádzajúcu.</p>}
          <input ref={fileInput} type="file" accept="image/*" capture="environment" hidden onChange={onFile} />
          {!preview ? (
            <button className="button button-big" disabled={busy} onClick={() => fileInput.current?.click()}>
              {busy ? 'Spracúvam…' : alreadySent ? '📷 Poslať novú fotku' : '📷 Odfotiť hárok'}
            </button>
          ) : (
            <div className="preview">
              <img src={preview.url} alt="Náhľad hárku" />
              <p className="hint">Je celý hárok ostrý a čitateľný?</p>
              <div className="cta-row">
                <button className="button button-big" onClick={send}>✓ Odoslať za tím {team.name}</button>
                <button className="button button-ghost" onClick={() => fileInput.current?.click()}>Odfotiť znova</button>
              </div>
            </div>
          )}
          <p className="hint">Tip: foťte zhora, celý hárok v zábere, bez odleskov lampy či projektora.</p>
        </>
      )}
      {msg && <p className={msg.type === 'ok' ? 'success' : 'alert'} role="status">{msg.text}</p>}
      {team && links[teamId] && <TeamLink token={links[teamId]} />}
    </article>
  )
}

// odkaz na opravené hárky tímu – ukáže sa po prvom odovzdaní
function TeamLink({ token }: { token: string }) {
  const url = `${location.origin}/tim/${token}`
  async function share() {
    if (navigator.share) { try { await navigator.share({ title: 'Naše hárky – Kvíz Factory', url }); return } catch { /* zrušené */ } }
    await navigator.clipboard?.writeText(url); alert('Odkaz je skopírovaný – pošlite ho tímu.')
  }
  return (
    <div className="team-link">
      <p><strong>Opravené hárky a body</strong> uvidíte po zverejnení výsledkov kola.</p>
      <div className="cta-row">
        <a className="button" href={url}>📄 Naše hárky</a>
        <button className="button button-ghost" onClick={share}>📤 Poslať tímu</button>
      </div>
    </div>
  )
}

// tím bez registrácie si napíše názov sám (iba pri kvízoch, ktoré to povoľujú)
function NewTeam({ quizId, onCreated }: { quizId: string; onCreated: (id: string) => void }) {
  const [name, setName] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState('')
  async function create() {
    setBusy(true); setErr('')
    const { data, error } = await supabase.rpc('create_submit_team', { p_quiz_id: quizId, p_name: name })
    setBusy(false)
    if (error) { setErr(/bad_name/.test(error.message) ? 'Názov musí mať 2 až 60 znakov.' : /submit_closed/.test(error.message) ? 'Odovzdávanie je zatvorené.' : 'Nepodarilo sa – skúste znova.'); return }
    onCreated(data as string)
  }
  return (
    <div className="form new-team">
      <label>Názov vášho tímu
        <input value={name} maxLength={60} placeholder="napr. Bystré hlavy" onChange={(e) => setName(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && name.trim().length >= 2 && create()} />
      </label>
      <p className="hint">Rovnaký názov si potom vyberiete aj v ďalších kolách.</p>
      <button className="button" disabled={busy || name.trim().length < 2} onClick={create}>{busy ? 'Ukladám…' : 'Pridať tím'}</button>
      {err && <p className="alert">{err}</p>}
    </div>
  )
}
