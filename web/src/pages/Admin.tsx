import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dateLong, dateTimeShort, eur, time } from '../lib/format'
import { Spinner } from '../components'
import { AdminGate } from '../AdminGate'

type EventRow = {
  id: string; slug: string; title: string; starts_at: string; venue: string
  capacity_teams: number; price_per_person_cents: number; door_price_per_person_cents: number; change_deadline_hours: number
  registration_open: boolean; is_public: boolean; shop_open: boolean
  payment_iban: string | null; payment_beneficiary: string | null
  teaser: { question: string; options: string[]; correct: number } | null
}
type Reg = {
  id: string; team_name: string; email: string; team_size: number; status: string
  payment_status: string; payment_method: string | null; amount_cents: number; variable_symbol: string
  paid_cents: number; manage_token: string; created_at: string
  attendance: 'yes' | 'no' | null; reminder_sent_at: string | null; email_sent_at: string | null; admin_note: string | null
}

export default function Admin() {
  return <AdminGate>{(email) => <Dashboard email={email} />}</AdminGate>
}

function Dashboard({ email }: { email: string }) {
  const [events, setEvents] = useState<EventRow[]>()
  const [eventId, setEventId] = useState<string>()

  const loadEvents = useCallback(async () => {
    const { data } = await supabase.from('events').select('*').order('starts_at', { ascending: false })
    setEvents(data as EventRow[])
    setEventId((cur) => cur ?? (data as EventRow[] | null)?.find((e) => e.is_public)?.id ?? data?.[0]?.id)
  }, [])
  useEffect(() => { loadEvents() }, [loadEvents])

  const event = events?.find((e) => e.id === eventId)
  return (
    <>
      <div className="admin-bar">
        <select value={eventId} onChange={(e) => setEventId(e.target.value)}>
          {events?.map((e) => <option key={e.id} value={e.id}>{e.title}{e.is_public ? '' : ' (neverejný)'}</option>)}
        </select>
        <a className="button button-small" href="/vstup">📷 Vstup / skenovanie</a>
        <span className="muted small">{email} · <button className="link" onClick={() => supabase.auth.signOut()}>Odhlásiť</button></span>
      </div>
      <NewEvent onCreated={async (id) => { await loadEvents(); setEventId(id) }} />
      {!events ? <Spinner /> : !event ? <p className="card center muted">Zatiaľ žiadny kvíz. Pridajte ho tlačidlom vyššie.</p> : (
        <>
          <EventSettings key={event.id} event={event} onSaved={loadEvents} onDeleted={async () => { setEventId(undefined); await loadEvents() }} />
          <Registrations event={event} />
          <Staff />
        </>
      )}
    </>
  )
}

function EventSettings({ event, onSaved, onDeleted }: { event: EventRow; onSaved: () => void; onDeleted: () => void }) {
  const [title, setTitle] = useState(event.title)
  const [startsAt, setStartsAt] = useState(toLocalInput(event.starts_at))
  const [venue, setVenue] = useState(event.venue)
  const [isPublic, setIsPublic] = useState(event.is_public)
  const [shopOpen, setShopOpen] = useState(event.shop_open)
  const [capacity, setCapacity] = useState(event.capacity_teams)
  const [price, setPrice] = useState(event.price_per_person_cents / 100)
  const [doorPrice, setDoorPrice] = useState(event.door_price_per_person_cents / 100)
  const [deadline, setDeadline] = useState(event.change_deadline_hours)
  const [iban, setIban] = useState(event.payment_iban ?? '')
  const [beneficiary, setBeneficiary] = useState(event.payment_beneficiary ?? '')
  const [tq, setTq] = useState(event.teaser?.question ?? '')
  const [to, setTo] = useState((event.teaser?.options ?? []).join('\n'))
  const [tc, setTc] = useState(event.teaser?.correct ?? 0)
  const [busy, setBusy] = useState(false)

  async function update(patch: Partial<EventRow>) {
    setBusy(true)
    const { error } = await supabase.from('events').update(patch).eq('id', event.id)
    setBusy(false)
    if (error) alert('Uloženie zlyhalo: ' + error.message)
    else onSaved()
  }

  async function deleteEvent() {
    const { count } = await supabase.from('registrations').select('id', { count: 'exact', head: true }).eq('event_id', event.id)
    if (count) { alert(`Kvíz má ${count} registrácií, zmazať ho nejde. Zrušte registrácie alebo kvíz skryte z webu.`); return }
    if (!confirm(`Naozaj zmazať kvíz „${event.title}“? Toto sa nedá vrátiť.`)) return
    setBusy(true)
    const { error } = await supabase.from('events').delete().eq('id', event.id)
    setBusy(false)
    if (error) alert('Zmazanie zlyhalo: ' + error.message)
    else onDeleted()
  }

  function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    const options = to.split('\n').map((s) => s.trim()).filter(Boolean)
    update({
      title: title.trim(),
      starts_at: new Date(startsAt).toISOString(),
      venue: venue.trim(),
      is_public: isPublic,
      shop_open: shopOpen,
      capacity_teams: capacity,
      price_per_person_cents: Math.round(price * 100),
      door_price_per_person_cents: Math.round(doorPrice * 100),
      change_deadline_hours: deadline,
      payment_iban: iban.replace(/\s+/g, '').toUpperCase() || null,
      payment_beneficiary: beneficiary.trim() || null,
      teaser: tq.trim() && options.length >= 2 ? { question: tq.trim(), options, correct: Math.min(tc, options.length - 1) } : null,
    })
  }

  return (
    <article className="card">
      <div className="event-head">
        <div>
          <h1>{event.title}</h1>
          <p className="event-meta">{dateLong(event.starts_at)} o {time(event.starts_at)} · {event.venue}</p>
        </div>
        <button
          className={`button ${event.registration_open ? 'button-danger' : ''}`}
          disabled={busy}
          onClick={() => {
            const msg = event.registration_open ? 'Zatvoriť registráciu? Nové tímy sa nebudú môcť prihlásiť.' : 'Otvoriť registráciu pre verejnosť?'
            if (confirm(msg)) update({ registration_open: !event.registration_open })
          }}
        >
          {event.registration_open ? '🔒 Zatvoriť registráciu' : '🔓 Otvoriť registráciu'}
        </button>
      </div>
      <p className={event.registration_open ? 'success' : 'muted'}>
        Registrácia je {event.registration_open ? 'OTVORENÁ' : 'zatvorená'}.
        {event.is_public ? ` Verejná adresa: ${location.origin}/registracia/${event.slug}` : ` Neverejný event – odkaz: ${location.origin}/registracia/${event.slug}`}
      </p>

      <details>
        <summary>Nastavenia (kapacita, ceny, platba, ochutnávka)</summary>
        <form className="form" onSubmit={saveSettings}>
          <label>Názov<input required value={title} onChange={(e) => setTitle(e.target.value)} /></label>
          <label>Dátum a čas<input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
          <label>Miesto<input required value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={isPublic} onChange={(e) => setIsPublic(e.target.checked)} /> <span>Zobraziť na webe (inak iba cez priamy odkaz)</span></label>
          <label>Kapacita (tímov)<input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label>
          <label>Cena za osobu online (€)<input type="number" min={0} step={0.5} value={price} onChange={(e) => setPrice(Number(e.target.value))} />
            <span className="hint">Platí pre nové registrácie a zmeny počtu. Už zaregistrované tímy si ponechajú svoju sumu.</span></label>
          <label>Cena za osobu na mieste (€)<input type="number" min={0} step={0.5} value={doorPrice} onChange={(e) => setDoorPrice(Number(e.target.value))} /></label>
          <label>Zníženie počtu / odhlásenie najneskôr (hodín pred kvízom)<input type="number" min={0} value={deadline} onChange={(e) => setDeadline(Number(e.target.value))} /></label>
          <label className="checkbox-row"><input type="checkbox" checked={shopOpen} onChange={(e) => setShopOpen(e.target.checked)} />
            <span><strong>Predaj vstupeniek spustený</strong> – tímom sa zobrazí QR na platbu a IBAN (na webe aj v e-maile). Kým je vypnuté, IBAN nikto nevidí.</span></label>
          <label>IBAN na prevod<input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="prázdne = iba platba na mieste" /></label>
          <label>Príjemca platby<input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} /></label>
          <label>Ochutnávková otázka<input value={tq} onChange={(e) => setTq(e.target.value)} placeholder="nepovinné" /></label>
          <label>Možnosti (každá na nový riadok)<textarea rows={3} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>Správna možnosť (poradie od 1)<input type="number" min={1} value={tc + 1} onChange={(e) => setTc(Number(e.target.value) - 1)} /></label>
          <button className="button" disabled={busy}>Uložiť nastavenia</button>
        </form>
        <p className="hint" style={{ marginTop: 18 }}>
          <button type="button" className="button button-small button-danger" disabled={busy} onClick={deleteEvent}>Zmazať kvíz</button>{' '}
          Zmazať sa dá iba kvíz bez registrácií. Kvíz s registráciami skryjete odškrtnutím „Zobraziť na webe“.
        </p>
      </details>
    </article>
  )
}

const STATUS_LABEL: Record<string, string> = { confirmed: 'Potvrdený', waitlist: 'Čakacia listina', cancelled: 'Zrušený' }

function Registrations({ event }: { event: EventRow }) {
  const [regs, setRegs] = useState<Reg[]>()
  const [filter, setFilter] = useState('')
  const [busyId, setBusyId] = useState<string>()

  const load = useCallback(async () => {
    const { data } = await supabase.from('registrations').select('*').eq('event_id', event.id).order('created_at')
    setRegs(data as Reg[])
  }, [event.id])

  useEffect(() => {
    load()
    // živé aktualizácie – nové registrácie a zmeny od ostatných adminov
    const ch = supabase.channel(`regs-${event.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'registrations', filter: `event_id=eq.${event.id}` }, () => load())
      .subscribe()
    return () => { supabase.removeChannel(ch) }
  }, [event.id, load])

  const stats = useMemo(() => {
    const c = (regs ?? []).filter((r) => r.status === 'confirmed')
    return {
      teams: c.length,
      people: c.reduce((s, r) => s + r.team_size, 0),
      paid: c.reduce((s, r) => s + r.paid_cents, 0),
      unpaid: c.reduce((s, r) => s + Math.max(r.amount_cents - r.paid_cents, 0), 0),
      waitlist: (regs ?? []).filter((r) => r.status === 'waitlist').length,
      attYes: c.filter((r) => r.attendance === 'yes').length,
      attNone: c.filter((r) => !r.attendance).length,
    }
  }, [regs])

  const shown = (regs ?? []).filter((r) => {
    const q = filter.trim().toLowerCase()
    return !q || r.team_name.toLowerCase().includes(q) || r.email.includes(q) || r.variable_symbol.includes(q)
  })

  async function act(r: Reg, fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusyId(r.id)
    const { error } = await fn()
    setBusyId(undefined)
    if (error) alert('Chyba: ' + error.message)
    else load()
  }
  const setPaid = async (r: Reg, method: string | null) => {
    if (method && !confirm(`Označiť tím „${r.team_name}“ ako zaplatený (${method === 'cash' ? 'hotovosť' : 'prevod'})?\nLístky mu odídu e-mailom na ${r.email}.`)) return
    if (!method && !confirm(`Zrušiť platbu tímu „${r.team_name}“? Lístky sa skryjú.`)) return
    await act(r, () => supabase.rpc('set_registration_paid', { p_registration_id: r.id, p_method: method }))
    if (method && r.status === 'confirmed') {
      const { error } = await supabase.functions.invoke('send-registration-email', { body: { token: r.manage_token, kind: 'tickets' } })
      if (error) alert('Platba je uložená, ale e-mail s lístkami neodišiel. Skúste tlačidlo „E-mail“.')
      load()
    }
  }
  const changeSize = (r: Reg, size: number) =>
    size !== r.team_size && confirm(`Zmeniť počet členov tímu „${r.team_name}“ z ${r.team_size} na ${size}? Pôvodné lístky ostanú platné.`) &&
    act(r, () => supabase.rpc('change_team_size', { p_registration_id: r.id, p_team_size: size }))
  const cancel = (r: Reg) => confirm(`Zrušiť registráciu tímu „${r.team_name}“?`) && act(r, () => supabase.from('registrations').update({ status: 'cancelled' }).eq('id', r.id))
  const confirmReg = (r: Reg) => act(r, () => supabase.rpc('confirm_registration', { p_registration_id: r.id }))
  const resend = (r: Reg) => {
    const kind = r.payment_status === 'paid' ? 'tickets' : 'registration'
    return confirm(`Poslať e-mail ${kind === 'tickets' ? 's lístkami' : 's potvrdením registrácie a pokynmi k platbe'} na ${r.email}?`) &&
      act(r, () => supabase.functions.invoke('send-registration-email', { body: { token: r.manage_token, kind, resend: true } }))
  }

  const [sendingReminders, setSendingReminders] = useState(false)
  // výzva ide potvrdeným tímom, ktoré ešte neodpovedali a výzvu ešte nedostali
  const remindTargets = (regs ?? []).filter((r) => r.status === 'confirmed' && !r.attendance && !r.reminder_sent_at && !r.email.startsWith('na-mieste@'))
  async function sendReminders() {
    if (!remindTargets.length) { alert('Všetky potvrdené tímy už výzvu dostali alebo odpovedali.'); return }
    const preview = `Predmet: Potvrďte účasť – <tím> | ${event.title}\n\n„Prídete na kvíz? Kvíz sa blíži! Dajte nám prosím vedieť, či prídete – kapacita je obmedzená a ak nemôžete, uvoľníme miesto ďalšiemu tímu.“\nTlačidlá: ✅ Prídeme · Zmeniť počet · ❌ Neprídeme`
    if (!confirm(`Poslať výzvu „Potvrďte účasť“ ${remindTargets.length} tímom?\n\n${preview}`)) return
    setSendingReminders(true)
    let failed = 0
    for (const r of remindTargets) {
      const { error } = await supabase.functions.invoke('send-registration-email', { body: { token: r.manage_token, kind: 'reminder', resend: true } })
      if (error) failed++
    }
    setSendingReminders(false)
    alert(failed ? `Odoslané ${remindTargets.length - failed}, zlyhalo ${failed}. Skúste znova.` : `Odoslané ${remindTargets.length} tímom.`)
    load()
  }

  function exportCsv() {
    const rows = [['poradie', 'tim', 'email', 'pocet', 'stav', 'platba', 'sposob', 'suma_eur', 'vs', 'registrovany'],
      ...(regs ?? []).map((r, i) => [i + 1, r.team_name, r.email, r.team_size, r.status, r.payment_status, r.payment_method ?? '', (r.amount_cents / 100).toFixed(2), r.variable_symbol, r.created_at])]
    const csv = '﻿' + rows.map((r) => r.map((v) => `"${String(v).replace(/"/g, '""')}"`).join(';')).join('\n')
    const a = document.createElement('a')
    a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }))
    a.download = `registracie-${event.slug}.csv`
    a.click()
  }

  if (!regs) return <Spinner />
  return (
    <article className="card">
      <div className="stats">
        <div><strong>{stats.teams}</strong>/{event.capacity_teams}<span>tímov</span></div>
        <div><strong>{stats.people}</strong><span>ľudí</span></div>
        <div><strong>{eur(stats.paid)}</strong><span>zaplatené</span></div>
        <div><strong>{eur(stats.unpaid)}</strong><span>nezaplatené</span></div>
        <div><strong>{stats.waitlist}</strong><span>čakacia listina</span></div>
        <div><strong>{stats.attYes}</strong><span>potvrdili účasť</span></div>
        <div><strong>{stats.attNone}</strong><span>bez odpovede</span></div>
      </div>
      <div className="admin-bar">
        <input placeholder="Hľadať tím, e-mail, VS…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <span className="cta-row">
          <button className="button button-small" disabled={sendingReminders} onClick={sendReminders}>
            {sendingReminders ? 'Posielam…' : `📨 Potvrďte účasť (${remindTargets.length})`}
          </button>
          <button className="button button-small button-ghost" onClick={exportCsv}>Export CSV</button>
        </span>
      </div>
      <div className="table-wrap">
        <table className="regs">
          <thead><tr><th>#</th><th>Tím</th><th>Ľudí</th><th>Stav</th><th>Platba</th><th>VS</th><th>Registrovaný</th><th></th></tr></thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.id} className={`st-${r.status} pay-${r.payment_status}`}>
                <td>{regs.indexOf(r) + 1}</td>
                <td><strong>{r.team_name}</strong><br /><span className="muted small">{r.email}</span></td>
                <td>
                  <select className="size-select" value={r.team_size} disabled={busyId === r.id || r.status === 'cancelled'} onChange={(e) => changeSize(r, Number(e.target.value))}>
                    {[1, 2, 3, 4, 5, 6].map((n) => <option key={n} value={n}>{n}</option>)}
                  </select>
                </td>
                <td>{STATUS_LABEL[r.status]}
                  {r.status === 'confirmed' && <><br /><span className="small">{r.attendance === 'yes' ? '✅ prídu' : r.reminder_sent_at ? '⏳ bez odpovede' : ''}</span></>}</td>
                <td>{r.payment_status === 'paid'
                  ? <>✅ {r.payment_method === 'cash' ? 'hotovosť' : r.payment_method === 'transfer' ? 'prevod' : r.payment_method ?? ''}
                      {r.paid_cents > r.amount_cents && <><br /><span className="warn">vrátiť {eur(r.paid_cents - r.amount_cents)}</span></>}</>
                  : r.paid_cents > 0 ? <>doplatiť {eur(r.amount_cents - r.paid_cents)}<br /><span className="muted small">zapl. {eur(r.paid_cents)}</span></> : eur(r.amount_cents)}</td>
                <td>{r.variable_symbol}</td>
                <td className="small">{dateTimeShort(r.created_at)}{r.email_sent_at ? '' : <><br /><span className="warn">e-mail neodišiel</span></>}
                  {r.admin_note && <><br /><span className="muted">{r.admin_note}</span></>}</td>
                <td className="actions">
                  {busyId === r.id ? '…' : (
                    <>
                      {r.status === 'confirmed' && r.payment_status !== 'paid' && <>
                        <button className="button button-small" onClick={() => setPaid(r, 'transfer')}>Prevod ✓</button>
                        <button className="button button-small" onClick={() => setPaid(r, 'cash')}>Hotovosť ✓</button>
                      </>}
                      {r.payment_status === 'paid' && <button className="button button-small button-ghost" onClick={() => setPaid(r, null)}>Zrušiť platbu</button>}
                      {r.status === 'waitlist' && <button className="button button-small" onClick={() => confirmReg(r)}>Potvrdiť</button>}
                      {r.status !== 'cancelled' && <button className="button button-small button-ghost" onClick={() => resend(r)}>E-mail</button>}
                      <a className="button button-small button-ghost" href={`/listky/${r.manage_token}`} target="_blank" rel="noreferrer">Lístky</a>
                      {r.status !== 'cancelled' && <button className="button button-small button-danger" onClick={() => cancel(r)}>Zrušiť</button>}
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {regs.length === 0 && <p className="muted center">Zatiaľ žiadne registrácie.</p>}
      </div>
    </article>
  )
}

type StaffRow = { id: string; email: string; role: 'admin' | 'door' | null; is_owner: boolean; last_sign_in_at: string | null; me: boolean }
const ROLE_LABEL = { admin: 'Admin', door: 'Vstup' }

function Staff() {
  const [staff, setStaff] = useState<StaffRow[]>()
  const [isOwner, setIsOwner] = useState(false)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<'admin' | 'door'>('door')
  const [busy, setBusy] = useState(false)

  const call = useCallback(async (body: object) => {
    const { data, error } = await supabase.functions.invoke('manage-staff', { body })
    if (error) {
      const code = await (error as { context?: Response }).context?.json?.().then((b: { error?: string }) => b.error).catch(() => undefined)
      alert(code === 'owner_only' ? 'Adminov môže pridávať a meniť iba hlavný admin.' : code === 'owner_protected' ? 'Hlavného admina nemožno meniť.' : 'Chyba: ' + (code ?? error.message))
      return null
    }
    return data
  }, [])
  const load = useCallback(async () => { const d = await call({ action: 'list' }); if (d) { setStaff(d.staff); setIsOwner(!!d.is_owner) } }, [call])
  useEffect(() => { load() }, [load])

  async function add(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    if (await call({ action: 'add', email, role })) { setEmail(''); await load() }
    setBusy(false)
  }
  async function setRoleOf(u: StaffRow, r: 'admin' | 'door' | null) {
    const msg = r === null ? `Odobrať prístup pre ${u.email}?` : `Zmeniť rolu ${u.email} na ${ROLE_LABEL[r]}?`
    if (!confirm(msg)) return
    if (await call({ action: 'set_role', user_id: u.id, role: r })) load()
  }

  return (
    <article className="card">
      <details>
        <summary>Organizátori a prístupy</summary>
        <p className="hint">
          <strong>Admin</strong> vidí všetko (administrácia, e-maily tímov, nastavenia). <strong>Vstup</strong> vidí iba obrazovku
          na vstupe na <code>/vstup</code>, bez e-mailov tímov. Prihlasuje sa odkazom zaslaným na e-mail. Nikto iný sa prihlásiť nevie.
          {isOwner ? ' Ako hlavný admin môžete pridávať aj adminov.' : ' Adminov pridáva iba hlavný admin.'}
        </p>
        {!staff ? <Spinner /> : (
          <div className="table-wrap">
            <table className="regs">
              <thead><tr><th>E-mail</th><th>Rola</th><th>Naposledy prihlásený</th><th></th></tr></thead>
              <tbody>
                {staff.filter((u) => u.role).map((u) => (
                  <tr key={u.id}>
                    <td>{u.email}{u.me && <span className="muted small"> (vy)</span>}</td>
                    <td>{u.is_owner ? 'Hlavný admin' : u.role ? ROLE_LABEL[u.role] : ''}</td>
                    <td className="small">{u.last_sign_in_at ? dateTimeShort(u.last_sign_in_at) : 'ešte nie'}</td>
                    <td className="actions">{!u.me && !u.is_owner && (isOwner || u.role === 'door') && <>
                      {isOwner && <button className="button button-small button-ghost" onClick={() => setRoleOf(u, u.role === 'admin' ? 'door' : 'admin')}>
                        Zmeniť na {u.role === 'admin' ? 'Vstup' : 'Admin'}</button>}
                      <button className="button button-small button-danger" onClick={() => setRoleOf(u, null)}>Odobrať</button>
                    </>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <form className="form" onSubmit={add}>
          <label>Pridať e-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          <label>Rola
            <select value={role} onChange={(e) => setRole(e.target.value as 'admin' | 'door')}>
              <option value="door">Vstup – iba skenovanie lístkov</option>
              {isOwner && <option value="admin">Admin – všetko</option>}
            </select>
          </label>
          <button className="button" disabled={busy}>{busy ? 'Pridávam…' : 'Pridať'}</button>
        </form>
      </details>
    </article>
  )
}

// datetime-local potrebuje "YYYY-MM-DDTHH:mm" v miestnom čase
function toLocalInput(iso: string) {
  const d = new Date(iso)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

function NewEvent({ onCreated }: { onCreated: (id: string) => void }) {
  const [open, setOpen] = useState(false)
  const [title, setTitle] = useState('Kvíz Factory')
  const [startsAt, setStartsAt] = useState('')
  const [venue, setVenue] = useState('Káčečko')
  const [capacity, setCapacity] = useState(35)
  const [openReg, setOpenReg] = useState(false)
  const [busy, setBusy] = useState(false)

  async function create(e: React.FormEvent) {
    e.preventDefault()
    setBusy(true)
    const base = startsAt.slice(0, 10) // YYYY-MM-DD
    let slug = base
    for (let i = 2; ; i++) {
      const { count } = await supabase.from('events').select('id', { count: 'exact', head: true }).eq('slug', slug)
      if (!count) break
      slug = `${base}-${i}`
    }
    const { data, error } = await supabase.from('events').insert({
      slug, title: title.trim(), starts_at: new Date(startsAt).toISOString(), venue: venue.trim(),
      capacity_teams: capacity, registration_open: openReg, is_public: true,
      price_per_person_cents: 700, door_price_per_person_cents: 700,
    }).select('id').single()
    setBusy(false)
    if (error) { alert('Vytvorenie zlyhalo: ' + error.message); return }
    setOpen(false)
    onCreated(data.id)
  }

  if (!open) return <p><button className="button button-small" onClick={() => setOpen(true)}>➕ Nový kvíz</button></p>
  return (
    <article className="card">
      <h2>Nový kvíz</h2>
      <form className="form" onSubmit={create}>
        <label>Názov<input required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="napr. Kvíz Factory vol. 26" /></label>
        <label>Dátum a čas<input required type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} /></label>
        <label>Miesto<input required value={venue} onChange={(e) => setVenue(e.target.value)} /></label>
        <label>Kapacita (tímov)<input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label>
        <label className="checkbox-row"><input type="checkbox" checked={openReg} onChange={(e) => setOpenReg(e.target.checked)} /> <span>Hneď otvoriť registráciu</span></label>
        <div className="cta-row">
          <button className="button" disabled={busy}>{busy ? 'Vytváram…' : 'Vytvoriť kvíz'}</button>
          <button type="button" className="button button-ghost" onClick={() => setOpen(false)}>Zrušiť</button>
        </div>
      </form>
    </article>
  )
}
