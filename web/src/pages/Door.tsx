import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import QrScanner from 'qr-scanner'
import { supabase } from '../lib/supabase'
import { eur, time } from '../lib/format'
import { Spinner } from '../components'
import { AdminGate } from '../AdminGate'

// Obrazovka na vstupe. Funguje aj bez internetu: lístky sa stiahnu do zariadenia,
// check-iny a platby v hotovosti sa uložia do fronty a odošlú, keď je spojenie.

type Ticket = { code: string; seat_no: number; checked_in_at: string | null }
type Team = {
  id: string; team_name: string; team_size: number; status: string
  payment_status: string; amount_cents: number; paid_cents: number; tickets: Ticket[]
}
type QueueItem = { kind: 'checkin'; code: string; at: string } | { kind: 'cash'; registration_id: string; at: string }
type EventLite = { id: string; title: string; starts_at: string; slug: string; price_per_person_cents: number }
type ScanResult =
  | { type: 'ok'; team: Team; seat: number }
  | { type: 'used'; team: Team; seat: number; at: string }
  | { type: 'unpaid'; team: Team; seat: number; code: string }
  | { type: 'cancelled'; team: Team }
  | { type: 'unknown'; code: string }

const load = <T,>(key: string, fallback: T): T => {
  try { const v = localStorage.getItem(key); return v ? (JSON.parse(v) as T) : fallback } catch { return fallback }
}
const save = (key: string, v: unknown) => { try { localStorage.setItem(key, JSON.stringify(v)) } catch { /* plné úložisko */ } }

export default function Door() {
  return <AdminGate>{() => <DoorPicker />}</AdminGate>
}

function DoorPicker() {
  const [events, setEvents] = useState<EventLite[]>(() => load('door:events', []))
  const [eventId, setEventId] = useState<string | undefined>(() => load<string | undefined>('door:eventId', undefined))

  useEffect(() => {
    supabase.from('events').select('id, title, starts_at, slug, price_per_person_cents').order('starts_at').then(({ data }) => {
      if (!data) return
      setEvents(data)
      save('door:events', data)
      // predvolene najbližší event, ktorý ešte neskončil
      setEventId((cur) => cur ?? data.find((e) => new Date(e.starts_at).getTime() > Date.now() - 12 * 3600e3)?.id ?? data[0]?.id)
    })
  }, [])
  useEffect(() => { if (eventId) save('door:eventId', eventId) }, [eventId])

  const event = events.find((e) => e.id === eventId)
  return (
    <div className="door">
      <select className="door-event" value={eventId} onChange={(e) => setEventId(e.target.value)}>
        {events.map((e) => <option key={e.id} value={e.id}>{e.title}</option>)}
      </select>
      {event ? <DoorScreen key={event.id} event={event} /> : <Spinner />}
    </div>
  )
}

function DoorScreen({ event }: { event: EventLite }) {
  const snapKey = `door:snap:${event.id}`
  const queueKey = `door:queue:${event.id}`
  const [teams, setTeams] = useState<Team[]>(() => load(snapKey, []))
  const [queue, setQueue] = useState<QueueItem[]>(() => load(queueKey, []))
  const [online, setOnline] = useState(navigator.onLine)
  const [syncedAt, setSyncedAt] = useState<Date>()
  const [tab, setTab] = useState<'scan' | 'teams' | 'add'>('scan')
  const [result, setResult] = useState<ScanResult>()
  const queueRef = useRef(queue)
  queueRef.current = queue

  // lokálne čakajúce akcie aplikujeme aj na čerstvé dáta zo servera
  const applyQueue = useCallback((list: Team[], q: QueueItem[]) => list.map((t) => {
    let team = t
    for (const item of q) {
      if (item.kind === 'cash' && item.registration_id === t.id) team = { ...team, payment_status: 'paid', paid_cents: team.amount_cents }
      if (item.kind === 'checkin' && team.tickets.some((x) => x.code === item.code && !x.checked_in_at))
        team = { ...team, tickets: team.tickets.map((x) => x.code === item.code ? { ...x, checked_in_at: item.at } : x) }
    }
    return team
  }), [])

  const refresh = useCallback(async () => {
    const { data, error } = await supabase
      .from('registrations')
      .select('id, team_name, team_size, status, payment_status, amount_cents, paid_cents, tickets(code, seat_no, checked_in_at)')
      .eq('event_id', event.id)
    if (error || !data) { setOnline(false); return }
    const list = applyQueue(data as Team[], queueRef.current)
    setTeams(list)
    save(snapKey, list)
    setOnline(true)
    setSyncedAt(new Date())
  }, [event.id, snapKey, applyQueue])

  const updateTeams = (fn: (t: Team[]) => Team[]) => setTeams((cur) => { const next = fn(cur); save(snapKey, next); return next })
  const enqueue = (items: QueueItem[]) => setQueue((cur) => { const next = [...cur, ...items]; save(queueKey, next); return next })

  // odoslanie fronty
  const flushing = useRef(false)
  const flush = useCallback(async () => {
    if (flushing.current || queueRef.current.length === 0) return
    flushing.current = true
    try {
      while (queueRef.current.length) {
        const item = queueRef.current[0]
        const { error } = item.kind === 'checkin'
          ? await supabase.rpc('check_in_ticket', { p_code: item.code, p_at: item.at })
          : await supabase.rpc('set_registration_paid', { p_registration_id: item.registration_id, p_method: 'cash' })
        if (error) {
          // sieťová chyba → skúsime neskôr; iná chyba → položku zahodíme, aby neblokovala frontu
          if (/fetch|network|Failed/i.test(error.message)) { setOnline(false); break }
          console.warn('door sync drop', item, error.message)
        }
        const rest = queueRef.current.slice(1)
        queueRef.current = rest
        setQueue(rest)
        save(queueKey, rest)
      }
      if (queueRef.current.length === 0) await refresh()
    } finally { flushing.current = false }
  }, [queueKey, refresh])

  useEffect(() => {
    refresh()
    const on = () => { setOnline(true); flush() }
    const off = () => setOnline(false)
    window.addEventListener('online', on)
    window.addEventListener('offline', off)
    const timer = setInterval(() => { flush(); if (queueRef.current.length === 0) refresh() }, 15000)
    // zmeny z iných zariadení (druhý skener, administrácia)
    let debounce: ReturnType<typeof setTimeout>
    const ch = supabase.channel(`door-${event.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'tickets' }, () => { clearTimeout(debounce); debounce = setTimeout(refresh, 800) })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `event_id=eq.${event.id}` }, () => { clearTimeout(debounce); debounce = setTimeout(refresh, 800) })
      .subscribe()
    return () => { window.removeEventListener('online', on); window.removeEventListener('offline', off); clearInterval(timer); supabase.removeChannel(ch) }
  }, [event.id, refresh, flush])
  useEffect(() => { if (queue.length) flush() }, [queue.length, flush])

  const byCode = useMemo(() => {
    const m = new Map<string, { team: Team; ticket: Ticket }>()
    for (const team of teams) for (const ticket of team.tickets) m.set(ticket.code, { team, ticket })
    return m
  }, [teams])

  const checkIn = (codes: string[]) => {
    const at = new Date().toISOString()
    updateTeams((list) => list.map((t) => ({ ...t, tickets: t.tickets.map((x) => codes.includes(x.code) && !x.checked_in_at ? { ...x, checked_in_at: at } : x) })))
    enqueue(codes.map((code) => ({ kind: 'checkin' as const, code, at })))
  }
  const markCash = (team: Team) => {
    updateTeams((list) => list.map((t) => t.id === team.id ? { ...t, payment_status: 'paid', paid_cents: t.amount_cents } : t))
    enqueue([{ kind: 'cash', registration_id: team.id, at: new Date().toISOString() }])
  }

  const onScan = useCallback((raw: string) => {
    const code = raw.trim()
    const hit = byCode.get(code)
    if (!hit) { feedback(false); setResult({ type: 'unknown', code }); return }
    const { team, ticket } = hit
    if (team.status !== 'confirmed') { feedback(false); setResult({ type: 'cancelled', team }); return }
    if (ticket.checked_in_at) { feedback(false); setResult({ type: 'used', team, seat: ticket.seat_no, at: ticket.checked_in_at }); return }
    if (team.payment_status !== 'paid') { feedback(false, true); setResult({ type: 'unpaid', team, seat: ticket.seat_no, code }); return }
    feedback(true)
    checkIn([code])
    setResult({ type: 'ok', team, seat: ticket.seat_no })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [byCode])

  const confirmed = teams.filter((t) => t.status === 'confirmed')
  const stats = {
    people: confirmed.reduce((s, t) => s + t.tickets.filter((x) => x.checked_in_at).length, 0),
    expected: confirmed.reduce((s, t) => s + t.team_size, 0),
    teamsIn: confirmed.filter((t) => t.tickets.some((x) => x.checked_in_at)).length,
    unpaid: confirmed.filter((t) => t.payment_status !== 'paid').length,
  }

  return (
    <>
      <div className="door-status">
        <span className={online ? 'dot dot-on' : 'dot dot-off'} />
        {online ? 'Online' : 'Offline – skeny sa uložia'}
        {queue.length > 0 && <span className="pill">čaká na odoslanie: {queue.length}</span>}
        <span className="muted small">{syncedAt ? `aktualizované ${time(syncedAt.toISOString())}` : ''}</span>
      </div>
      <div className="door-stats">
        <div><strong>{stats.people}</strong>/{stats.expected}<span>ľudí vnútri</span></div>
        <div><strong>{stats.teamsIn}</strong>/{confirmed.length}<span>tímov</span></div>
        <div><strong>{stats.unpaid}</strong><span>nezaplatených</span></div>
      </div>
      <nav className="door-tabs">
        <button className={tab === 'scan' ? 'active' : ''} onClick={() => setTab('scan')}>📷 Skenovať</button>
        <button className={tab === 'teams' ? 'active' : ''} onClick={() => setTab('teams')}>👥 Tímy</button>
        <button className={tab === 'add' ? 'active' : ''} onClick={() => setTab('add')}>➕ Na mieste</button>
      </nav>

      {tab === 'scan' && <Scanner onScan={onScan} paused={!!result} />}
      {tab === 'teams' && <TeamList teams={teams} onCheckIn={checkIn} onCash={markCash} />}
      {tab === 'add' && <AddTeam eventId={event.id} price={event.price_per_person_cents} online={online} onAdded={() => { refresh(); setTab('teams') }} />}

      {result && (
        <ResultOverlay
          result={result}
          onClose={() => setResult(undefined)}
          onCashAndIn={(r) => { markCash(r.team); checkIn([r.code]); feedback(true); setResult({ type: 'ok', team: r.team, seat: r.seat }) }}
        />
      )}
    </>
  )
}

function Scanner({ onScan, paused }: { onScan: (code: string) => void; paused: boolean }) {
  const video = useRef<HTMLVideoElement>(null)
  const scanner = useRef<QrScanner>(null)
  const last = useRef({ code: '', at: 0 })
  const cb = useRef(onScan)
  cb.current = onScan
  const [error, setError] = useState<string>()
  const [manual, setManual] = useState('')

  useEffect(() => {
    if (!video.current) return
    const s = new QrScanner(video.current, (res) => {
      const now = Date.now()
      if (res.data === last.current.code && now - last.current.at < 4000) return // ten istý kód pred kamerou
      last.current = { code: res.data, at: now }
      cb.current(res.data)
    }, { preferredCamera: 'environment', highlightScanRegion: true, highlightCodeOutline: true, maxScansPerSecond: 8 })
    scanner.current = s
    s.start().catch(() => setError('Kamera nie je dostupná. Povoľte prístup ku kamere v prehliadači.'))
    return () => { s.destroy(); scanner.current = null }
  }, [])

  useEffect(() => {
    if (paused) scanner.current?.pause()
    else scanner.current?.start().catch(() => {})
  }, [paused])

  return (
    <div className="scanner">
      <video ref={video} className="scanner-video" muted playsInline />
      {error && <p className="alert">{error}</p>}
      <form className="manual" onSubmit={(e) => { e.preventDefault(); if (manual.trim()) { cb.current(manual.trim().toUpperCase()); setManual('') } }}>
        <input placeholder="Kód ručne (KF-…)" value={manual} onChange={(e) => setManual(e.target.value)} autoCapitalize="characters" />
        <button className="button button-small">Overiť</button>
      </form>
    </div>
  )
}

function ResultOverlay({ result, onClose, onCashAndIn }: {
  result: ScanResult
  onClose: () => void
  onCashAndIn: (r: Extract<ScanResult, { type: 'unpaid' }>) => void
}) {
  // úspešný sken sa zavrie sám, aby sa dalo plynulo skenovať ďalej
  useEffect(() => {
    if (result.type !== 'ok') return
    const t = setTimeout(onClose, 1600)
    return () => clearTimeout(t)
  }, [result, onClose])

  const team = 'team' in result ? result.team : undefined
  const inside = team ? team.tickets.filter((x) => x.checked_in_at).length : 0
  return (
    <div className={`door-result door-result-${result.type}`} onClick={result.type === 'unpaid' ? undefined : onClose} role="alert">
      <div className="door-result-icon">{{ ok: '✅', used: '⛔', unpaid: '💶', cancelled: '⛔', unknown: '❓' }[result.type]}</div>
      <div className="door-result-title">
        {{ ok: 'VSTUP OK', used: 'UŽ POUŽITÝ', unpaid: 'NEZAPLATENÉ', cancelled: 'ZRUŠENÁ REGISTRÁCIA', unknown: 'NEZNÁMY LÍSTOK' }[result.type]}
      </div>
      {team && <div className="door-result-team">{team.team_name}</div>}
      {'seat' in result && <div className="door-result-sub">lístok {result.seat}/{team!.team_size} · vnútri {inside}/{team!.team_size}</div>}
      {result.type === 'used' && <div className="door-result-sub">naskenovaný o {time(result.at)}</div>}
      {result.type === 'unknown' && <div className="door-result-sub mono">{result.code.slice(0, 40)}</div>}
      {result.type === 'unpaid' && (
        <div className="door-result-actions">
          <div className="door-result-sub">Vybrať {eur(team!.amount_cents - team!.paid_cents)} za celý tím ({team!.team_size} os.)</div>
          <button className="button" onClick={() => onCashAndIn(result)}>Zaplatené v hotovosti ✓ a pustiť</button>
          <button className="button button-ghost" onClick={onClose}>Zrušiť</button>
        </div>
      )}
      {result.type !== 'unpaid' && <div className="door-result-hint">ťuknutím zavrieť</div>}
    </div>
  )
}

function TeamList({ teams, onCheckIn, onCash }: { teams: Team[]; onCheckIn: (codes: string[]) => void; onCash: (t: Team) => void }) {
  const [q, setQ] = useState('')
  const norm = (s: string) => s.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase()
  const shown = teams
    .filter((t) => t.status === 'confirmed' && (!q || norm(t.team_name).includes(norm(q))))
    .sort((a, b) => a.team_name.localeCompare(b.team_name, 'sk'))
  return (
    <div className="door-teams">
      <input className="door-search" placeholder="Hľadať tím…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      {shown.map((t) => {
        const unused = t.tickets.filter((x) => !x.checked_in_at).sort((a, b) => a.seat_no - b.seat_no)
        const inside = t.team_size - unused.length
        const paid = t.payment_status === 'paid'
        return (
          <div key={t.id} className={`door-team ${inside === t.team_size ? 'all-in' : ''}`}>
            <div className="door-team-head">
              <strong>{t.team_name}</strong>
              <span className={paid ? 'badge badge-paid' : 'badge badge-unpaid'}>{paid ? 'zaplatené' : `nezaplatené ${eur(t.amount_cents - t.paid_cents)}`}</span>
            </div>
            <div className="door-team-row">
              <span>vnútri <strong>{inside}/{t.team_size}</strong></span>
              <span className="door-team-actions">
                {!paid && <button className="button button-small" onClick={() => confirm(`Tím „${t.team_name}“ zaplatil ${eur(t.amount_cents - t.paid_cents)} v hotovosti?`) && onCash(t)}>Hotovosť ✓</button>}
                {paid && unused.length > 0 && <>
                  <button className="button button-small button-ghost" onClick={() => onCheckIn([unused[0].code])}>Pustiť 1</button>
                  {unused.length > 1 && <button className="button button-small" onClick={() => onCheckIn(unused.map((x) => x.code))}>Pustiť {unused.length}</button>}
                </>}
              </span>
            </div>
          </div>
        )
      })}
      {shown.length === 0 && <p className="muted center">Žiadny tím.</p>}
    </div>
  )
}

function AddTeam({ eventId, price, online, onAdded }: { eventId: string; price: number; online: boolean; onAdded: () => void }) {
  const [name, setName] = useState('')
  const [size, setSize] = useState(6)
  const [paid, setPaid] = useState(true)
  const [busy, setBusy] = useState(false)
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const { error } = await supabase.rpc('admin_add_team', { p_event_id: eventId, p_team_name: name, p_team_size: size, p_paid_cash: paid })
    setBusy(false)
    if (error) alert(error.message.includes('team_name_taken') ? 'Tím s týmto názvom už existuje.' : 'Nepodarilo sa pridať tím: ' + error.message)
    else { setName(''); onAdded() }
  }
  return (
    <form className="form card" onSubmit={submit}>
      <h2>Tím bez registrácie</h2>
      {!online && <p className="alert">Na pridanie tímu treba internet.</p>}
      <label>Názov tímu<input required value={name} onChange={(e) => setName(e.target.value)} /></label>
      <label>Počet ľudí
        <select value={size} onChange={(e) => setSize(Number(e.target.value))}>{[6, 5, 4, 3, 2, 1].map((n) => <option key={n}>{n}</option>)}</select>
      </label>
      <label className="checkbox-row"><input type="checkbox" checked={paid} onChange={(e) => setPaid(e.target.checked)} /> <span>Zaplatené v hotovosti ({eur(size * price)})</span></label>
      <button className="button" disabled={busy || !online}>{busy ? 'Pridávam…' : 'Pridať tím'}</button>
      <p className="hint">Tím sa pridá aj nad kapacitu. Členov potom pustíte v záložke Tímy.</p>
    </form>
  )
}

// zvuk + vibrácia (ok = krátky vysoký tón, chyba = dva nízke)
let audio: AudioContext | undefined
function feedback(ok: boolean, warn = false) {
  try {
    audio ??= new AudioContext()
    const beep = (freq: number, start: number, dur: number) => {
      const o = audio!.createOscillator(); const g = audio!.createGain()
      o.frequency.value = freq; o.connect(g); g.connect(audio!.destination)
      g.gain.setValueAtTime(0.25, audio!.currentTime + start); g.gain.exponentialRampToValueAtTime(0.001, audio!.currentTime + start + dur)
      o.start(audio!.currentTime + start); o.stop(audio!.currentTime + start + dur)
    }
    if (ok) beep(1320, 0, 0.15)
    else if (warn) { beep(660, 0, 0.18); beep(660, 0.25, 0.18) }
    else { beep(220, 0, 0.25); beep(180, 0.3, 0.35) }
  } catch { /* bez zvuku */ }
  navigator.vibrate?.(ok ? 80 : [200, 100, 200])
}
