import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { friendlyError, supabase, type PublicEvent } from '../lib/supabase'
import { dateLong, eur, time } from '../lib/format'
import { Spinner } from '../components'

export default function Register() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<PublicEvent | null>()
  const [teamName, setTeamName] = useState('')
  const [email, setEmail] = useState('')
  const [size, setSize] = useState(6)
  const [teaser, setTeaser] = useState<number | null>(null)
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    supabase.rpc('event_by_slug', { p_slug: slug }).then(({ data }) => {
      const e = (data as PublicEvent[] | null)?.[0] ?? null
      setEvent(e)
      if (e) setSize(e.max_team_size)
    })
  }, [slug])

  if (event === undefined) return <Spinner />
  if (event === null) return <p className="card center">Tento kvíz neexistuje.</p>

  const free = Math.max(event.capacity_teams - event.taken, 0)
  const sizes = Array.from({ length: event.max_team_size - event.min_team_size + 1 }, (_, i) => event.max_team_size - i)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!event || sending) return
    setSending(true)
    setError(undefined)
    const { data, error } = await supabase.rpc('register_team', {
      p_event_id: event.id,
      p_team_name: teamName,
      p_email: email,
      p_team_size: size,
      p_teaser_answer: teaser,
    })
    if (error) {
      setError(friendlyError(error.message))
      setSending(false)
      return
    }
    const reg = (data as { manage_token: string }[])[0]
    // E-mail s lístkami – ak zlyhá, tím má lístky aj tak na stránke
    supabase.functions.invoke('send-registration-email', { body: { token: reg.manage_token } }).catch(() => {})
    navigate(`/listky/${reg.manage_token}?nova=1`)
  }

  return (
    <article className="card">
      <h1>Registrácia tímu</h1>
      <p className="event-meta">
        {event.title} · <strong>{dateLong(event.starts_at)}</strong> o {time(event.starts_at)} · {event.venue}
      </p>

      {!event.registration_open ? (
        <p className="alert">Registrácia na tento kvíz je momentálne zatvorená.</p>
      ) : (
        <form onSubmit={submit} className="form">
          {free === 0 && <p className="alert">Kapacita je naplnená. Po odoslaní budete na čakacej listine a ozveme sa, ak sa uvoľní miesto.</p>}

          <label>
            Názov tímu
            <input required maxLength={60} value={teamName} onChange={(e) => setTeamName(e.target.value)} autoComplete="off" />
          </label>

          <label>
            E-mail kapitána
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
            <span className="hint">Pošleme vám naň potvrdenie a po zaplatení lístky. Nikomu ho nedávame.</span>
          </label>

          <fieldset>
            <legend>Počet členov tímu</legend>
            <span className="hint">Do {event.change_deadline_hours} h pred kvízom môžete počet ľubovoľne meniť alebo registráciu zrušiť (cez odkaz z e-mailu). Potom už môžete členov len pridať.</span>
            <div className="size-options">
              {sizes.map((n) => (
                <label key={n} className={`size-option ${size === n ? 'selected' : ''}`}>
                  <input type="radio" name="size" value={n} checked={size === n} onChange={() => setSize(n)} />
                  <span className="size-n">{n}</span>
                  <span className="size-price">{eur(n * event.price_per_person_cents)}</span>
                </label>
              ))}
            </div>
            <span className="hint">Ceny sú pri platbe vopred online ({eur(event.price_per_person_cents)}/os.). Na mieste {eur(event.door_price_per_person_cents)}/os. Po zaplatení dostane každý člen vlastný lístok s QR kódom.</span>
          </fieldset>

          {event.teaser_question && event.teaser_options && (
            <fieldset>
              <legend>Malá ochutnávka: {event.teaser_question}</legend>
              {event.teaser_options.map((o, i) => (
                <label key={i} className="radio-row">
                  <input type="radio" name="teaser" checked={teaser === i} onChange={() => setTeaser(i)} /> {o}
                </label>
              ))}
              <span className="hint">Nepovinné. Správnu odpoveď uvidíte po registrácii.</span>
            </fieldset>
          )}

          <label className="checkbox-row">
            <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Súhlasím s <a href="/podmienky" target="_blank">podmienkami účasti</a> (počet členov môžem meniť alebo registráciu zrušiť do {event.change_deadline_hours} h pred kvízom, potom už len pridať – pri neúčasti vstupné prepadá)
              a so spracovaním e-mailu a názvu tímu podľa <a href="/ochrana-udajov" target="_blank">informácií o ochrane osobných údajov</a>.
            </span>
          </label>

          {error && <p className="alert" role="alert">{error}</p>}

          <button className="button" disabled={sending}>
            {sending ? 'Odosielam…' : `Registrovať tím · ${eur(size * event.price_per_person_cents)}`}
          </button>
          <p className="hint center">
            {event.has_transfer ? 'Po registrácii zaplatíte prevodom cez QR kód. Lístky dostanete hneď po zaplatení.' : 'Pokyny k platbe vám budú doručené čoskoro. Lístky dostanete po zaplatení.'}
          </p>
        </form>
      )}
    </article>
  )
}
