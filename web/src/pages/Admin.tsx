import { useCallback, useEffect, useMemo, useState } from 'react'
import { supabase } from '../lib/supabase'
import { dateLong, dateTimeShort, eur, time } from '../lib/format'
import { Spinner } from '../components'
import { AdminGate } from '../AdminGate'

type EventRow = {
  id: string; slug: string; title: string; starts_at: string; venue: string
  capacity_teams: number; price_per_person_cents: number; registration_open: boolean; is_public: boolean
  payment_iban: string | null; payment_beneficiary: string | null
  teaser: { question: string; options: string[]; correct: number } | null
}
type Reg = {
  id: string; team_name: string; email: string; team_size: number; status: string
  payment_status: string; payment_method: string | null; amount_cents: number; variable_symbol: string
  paid_cents: number; manage_token: string; created_at: string; email_sent_at: string | null; admin_note: string | null
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
      {!event ? <Spinner /> : (
        <>
          <EventSettings key={event.id} event={event} onSaved={loadEvents} />
          <Registrations event={event} />
        </>
      )}
    </>
  )
}

function EventSettings({ event, onSaved }: { event: EventRow; onSaved: () => void }) {
  const [capacity, setCapacity] = useState(event.capacity_teams)
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

  function saveSettings(e: React.FormEvent) {
    e.preventDefault()
    const options = to.split('\n').map((s) => s.trim()).filter(Boolean)
    update({
      capacity_teams: capacity,
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
        <summary>Nastavenia (kapacita, platba, ochutnávka)</summary>
        <form className="form" onSubmit={saveSettings}>
          <label>Kapacita (tímov)<input type="number" min={1} value={capacity} onChange={(e) => setCapacity(Number(e.target.value))} /></label>
          <label>IBAN na prevod<input value={iban} onChange={(e) => setIban(e.target.value)} placeholder="prázdne = iba platba na mieste" /></label>
          <label>Príjemca platby<input value={beneficiary} onChange={(e) => setBeneficiary(e.target.value)} /></label>
          <label>Ochutnávková otázka<input value={tq} onChange={(e) => setTq(e.target.value)} placeholder="nepovinné" /></label>
          <label>Možnosti (každá na nový riadok)<textarea rows={3} value={to} onChange={(e) => setTo(e.target.value)} /></label>
          <label>Správna možnosť (poradie od 1)<input type="number" min={1} value={tc + 1} onChange={(e) => setTc(Number(e.target.value) - 1)} /></label>
          <button className="button" disabled={busy}>Uložiť nastavenia</button>
        </form>
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
      </div>
      <div className="admin-bar">
        <input placeholder="Hľadať tím, e-mail, VS…" value={filter} onChange={(e) => setFilter(e.target.value)} />
        <button className="button button-small button-ghost" onClick={exportCsv}>Export CSV</button>
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
                <td>{STATUS_LABEL[r.status]}</td>
                <td>{r.payment_status === 'paid'
                  ? `✅ ${r.payment_method === 'cash' ? 'hotovosť' : r.payment_method === 'transfer' ? 'prevod' : r.payment_method ?? ''}`
                  : r.paid_cents > 0 ? <>doplatiť {eur(r.amount_cents - r.paid_cents)}<br /><span className="muted small">zapl. {eur(r.paid_cents)}</span></> : eur(r.amount_cents)}</td>
                <td>{r.variable_symbol}</td>
                <td className="small">{dateTimeShort(r.created_at)}{r.email_sent_at ? '' : <><br /><span className="warn">e-mail neodišiel</span></>}</td>
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
