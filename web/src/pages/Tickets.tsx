import { useEffect, useMemo, useState } from 'react'
import { useParams, useSearchParams } from 'react-router-dom'
import { supabase, type RegistrationView } from '../lib/supabase'
import { dateLong, eur, formatIban, time } from '../lib/format'
import { payBySquare } from '../lib/payBySquare'
import { QR, Spinner } from '../components'

export default function Tickets() {
  const { token = '' } = useParams()
  const [params] = useSearchParams()
  const isNew = params.get('nova') === '1'
  const onlySeat = params.get('listok') ? Number(params.get('listok')) : null
  const [reg, setReg] = useState<RegistrationView | null>()

  useEffect(() => {
    supabase.rpc('registration_by_token', { p_token: token }).then(({ data, error }) => setReg(error ? null : (data as RegistrationView | null)))
  }, [token])

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
                    : <><strong>Na úhradu: {eur(reg.amount_cents)}</strong> ({reg.team_size} × {eur(reg.amount_cents / reg.team_size)})</>}
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
                    <p className="hint">Naskenujte QR kód v bankovej aplikácii. Po pripísaní platby vám pošleme lístky e-mailom a zobrazia sa aj tu.</p>
                  </div>
                ) : (
                  <p className="hint">Pokyny k platbe vám budú doručené čoskoro. Lístky dostanete po zaplatení.</p>
                )}
              </>
            )}
          </div>
        )}
      </article>

      {reg.status === 'confirmed' && reg.payment_status !== 'paid' && reg.tickets.length === 0 && (
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
