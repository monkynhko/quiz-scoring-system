import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { friendlyError, supabase, type RegistrationView } from '../lib/supabase'
import { dateLong, dateTimeShort, eur, formatIban, time } from '../lib/format'
import { payBySquare } from '../lib/payBySquare'
import { QR, Spinner } from '../components'

export default function Tickets() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const isNew = params.get('nova') === '1'
  const onlySeat = params.get('listok') ? Number(params.get('listok')) : null
  const [reg, setReg] = useState<RegistrationView | null>()
  const reload = () => supabase.rpc('registration_by_token', { p_token: token }).then(({ data, error }) => setReg(error ? null : (data as RegistrationView | null)))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  useEffect(() => { reload() }, [token])

  const payQr = useMemo(() => {
    if (!reg?.event.payment_iban || reg.payment_status !== 'unpaid' || reg.status !== 'confirmed') return null
    return payBySquare({
      iban: reg.event.payment_iban,
      beneficiary: reg.event.payment_beneficiary ?? 'Kviz Factory',
      amountCents: reg.amount_cents - reg.paid_cents,
      variableSymbol: reg.variable_symbol,
      note: `Kviz Factory - ${reg.team_name}`,
    })
  }, [reg])

  if (reg === undefined) return <Spinner />
  if (reg === null) return <p className="card center">Registrácia sa nenašla. Skontrolujte odkaz z e-mailu.</p>

  const e = reg.event
  const tickets = onlySeat ? reg.tickets.filter((t) => t.seat_no === onlySeat) : reg.tickets

  async function share(seat: number) {
    const url = `${location.origin}/listky/${token}?listok=${seat}`
    const text = `Lístok ${seat}/${reg!.team_size} – ${reg!.team_name}, ${e.title}`
    if (navigator.share) await navigator.share({ title: text, url }).catch(() => {})
    else {
      await navigator.clipboard.writeText(url)
      alert('Odkaz na lístok je skopírovaný.')
    }
  }

  return (
    <>
      <article className="card">
        {isNew && reg.status === 'confirmed' && <p className="success">Tím je zaregistrovaný! Potvrdenie sme poslali aj na e-mail.</p>}
        <h1>{reg.team_name}</h1>
        <p className="event-meta">
          {e.title} · <strong>{dateLong(e.starts_at)}</strong> o {time(e.starts_at)} · {e.venue}
        </p>

        {reg.status === 'waitlist' && (
          <p className="alert">
            Ste na <strong>čakacej listine</strong>. Ak sa uvoľní miesto, pošleme vám lístky e-mailom.
          </p>
        )}
        {reg.status === 'cancelled' && <p className="alert">Táto registrácia bola zrušená.</p>}

        {reg.status === 'confirmed' && (
          <div className={`payment ${reg.payment_status === 'paid' ? 'paid' : ''}`}>
            {reg.payment_status === 'paid' ? (
              <p><strong>✅ Zaplatené</strong> · {eur(reg.amount_cents)} za {reg.team_size} osôb</p>
            ) : (
              <>
                <p>
                  {reg.paid_cents > 0
                    ? <><strong>Doplatok: {eur(reg.amount_cents - reg.paid_cents)}</strong> (spolu {eur(reg.amount_cents)}, zaplatené {eur(reg.paid_cents)})</>
                    : <><strong>Vstupné: {eur(reg.amount_cents)}</strong> ({reg.team_size} × {eur(reg.amount_cents / reg.team_size)})</>}
                </p>
                {payQr && e.payment_iban ? (
                  <div className="pay-grid">
                    <QR value={payQr} size={180} label="QR kód na platbu" />
                    <dl className="pay-details">
                      <dt>IBAN</dt><dd>{formatIban(e.payment_iban)}</dd>
                      <dt>Príjemca</dt><dd>{e.payment_beneficiary}</dd>
                      <dt>Variabilný symbol</dt><dd><strong>{reg.variable_symbol}</strong></dd>
                      <dt>Suma</dt><dd>{eur(reg.amount_cents - reg.paid_cents)}</dd>
                    </dl>
                    <p className="hint">Naskenujte QR kód v bankovej aplikácii. Po pripísaní platby vám pošleme vstupenky e-mailom a zobrazia sa aj tu.</p>
                  </div>
                ) : (
                  <p className="hint">Vstupné zaplatíte na mieste. Online predaj vstupeniek pripravujeme – po spustení vám dáme vedieť.</p>
                )}
              </>
            )}
          </div>
        )}
      </article>

      {reg.status === 'confirmed' && reg.payment_status !== 'paid' && reg.tickets.length === 0 && e.payment_iban && (
        <>
          <h2 className="section-title">Lístky</h2>
          <div className="tickets">
            {Array.from({ length: reg.team_size }, (_, i) => (
              <div key={i} className="ticket locked">
                <div className="ticket-head"><img src="/logo-small.webp" alt="" /><span className="ticket-no">{i + 1}/{reg.team_size}</span></div>
                <div className="qr-lock">🔒 Lístok sa zobrazí po zaplatení</div>
                <p className="ticket-team">{reg.team_name}</p>
              </div>
            ))}
          </div>
        </>
      )}

      {reg.status === 'confirmed' && reg.tickets.length > 0 && (
        <>
          <h2 className="section-title">Lístky</h2>
          <p className="muted center small">Každý člen tímu ukáže pri vstupe svoj QR kód. Lístky môžete rozposlať tlačidlom „Poslať“.</p>
          <div className="tickets">
            {tickets.map((t) => (
              <div key={t.seat_no} className={`ticket ${t.checked_in ? 'used' : ''}`}>
                <div className="ticket-head">
                  <img src="/logo-small.webp" alt="" />
                  <span className="ticket-no">{t.seat_no}/{reg.team_size}</span>
                </div>
                <QR value={t.code} size={200} label={`Lístok ${t.seat_no}`} />
                <p className="ticket-team">{reg.team_name}</p>
                <p className="ticket-date">{dateLong(e.starts_at)} · {time(e.starts_at)}</p>
                <p className="ticket-code">{t.code}</p>
                {t.checked_in ? <p className="ticket-used">Použitý</p> : !onlySeat && (
                  <button className="button button-small button-ghost" onClick={() => share(t.seat_no)}>Poslať</button>
                )}
              </div>
            ))}
          </div>
          {onlySeat && <p className="center small"><a href={`/listky/${token}`}>Zobraziť všetky lístky tímu</a></p>}
        </>
      )}

      {reg.status !== 'cancelled' && !onlySeat && <ManageTeam reg={reg} token={token} onChanged={reload} />}

      {e.teaser && reg.teaser_answer !== null && (
        <article className="card">
          <h2>Ochutnávka: {e.teaser.question}</h2>
          <p>
            Správna odpoveď: <strong>{e.teaser.options[e.teaser.correct]}</strong>
            {reg.teaser_answer === e.teaser.correct ? ' – trafili ste! 🎉' : ` (vaša odpoveď: ${e.teaser.options[reg.teaser_answer]})`}
          </p>
        </article>
      )}
    </>
  )
}

function ManageTeam({ reg, token, onChanged }: { reg: RegistrationView; token: string; onChanged: () => void }) {
  const e = reg.event
  const [size, setSize] = useState(reg.team_size)
  const [busy, setBusy] = useState(false)
  const now = Date.now()
  const started = now >= new Date(e.starts_at).getTime()
  const beforeDeadline = now < new Date(e.change_deadline).getTime()
  if (started) return null
  const sizes = Array.from({ length: e.max_team_size - e.min_team_size + 1 }, (_, i) => e.min_team_size + i)
    .filter((n) => beforeDeadline || n >= reg.team_size)

  async function run(fn: () => PromiseLike<{ error: { message: string } | null }>) {
    setBusy(true)
    const { error } = await fn()
    setBusy(false)
    if (error) alert(friendlyError(error.message))
    else onChanged()
  }
  const diff = (size - reg.team_size) * e.price_per_person_cents
  return (
    <details className="card">
      <summary>Zmeniť počet členov alebo zrušiť registráciu</summary>
      <p className="hint">
        {beforeDeadline
          ? <>Do <strong>{dateTimeShort(e.change_deadline)}</strong> môžete počet ľubovoľne meniť alebo registráciu zrušiť. Potom už môžete členov len pridať.</>
          : <>Lehota na zmeny uplynula ({dateTimeShort(e.change_deadline)}). Členov môžete už len pridať.</>}
      </p>
      <div className="admin-bar">
        <select value={size} onChange={(ev) => setSize(Number(ev.target.value))} disabled={busy}>
          {sizes.map((n) => <option key={n} value={n}>{n} {n >= 5 ? 'osôb' : 'osoby'}</option>)}
        </select>
        <button className="button button-small" disabled={busy || size === reg.team_size}
          onClick={() => confirm(`Zmeniť počet členov na ${size}?${diff > 0 && reg.payment_status === 'paid' ? ` Doplatok ${eur(diff)}.` : ''}`) && run(() => supabase.rpc('team_change_size', { p_token: token, p_team_size: size }))}>
          Uložiť zmenu
        </button>
        {beforeDeadline && (
          <button className="button button-small button-danger" disabled={busy}
            onClick={() => confirm('Naozaj zrušiť registráciu tímu? Toto sa nedá vrátiť späť.') && run(() => supabase.rpc('team_cancel', { p_token: token }))}>
            Zrušiť registráciu
          </button>
        )}
      </div>
      {reg.paid_cents > reg.amount_cents && <p className="hint">Preplatok {eur(reg.paid_cents - reg.amount_cents)} vám vrátime.</p>}
    </details>
  )
}
