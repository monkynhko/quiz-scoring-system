import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { friendlyError, supabase, type PublicEvent } from '../lib/supabase'
import { dateLong, time } from '../lib/format'
import { Spinner } from '../components'

export default function Register() {
  const { slug = '' } = useParams()
  const navigate = useNavigate()
  const [event, setEvent] = useState<PublicEvent | null>()
  const [teamName, setTeamName] = useState('')
  const [email, setEmail] = useState('')
  const [size, setSize] = useState<number>()
  const [teaser, setTeaser] = useState<number | null>(null)
  const [consent, setConsent] = useState(false)
  const [sending, setSending] = useState(false)
  const [error, setError] = useState<string>()

  useEffect(() => {
    supabase.rpc('event_by_slug', { p_slug: slug }).then(({ data }) => setEvent((data as PublicEvent[] | null)?.[0] ?? null))
  }, [slug])

  if (event === undefined) return <Spinner />
  if (event === null) return <p className="card center">Tento kvíz neexistuje.</p>

  const full = event.taken >= event.capacity_teams
  const sizes = Array.from({ length: event.max_team_size - event.min_team_size + 1 }, (_, i) => event.min_team_size + i)

  async function submit(ev: React.FormEvent) {
    ev.preventDefault()
    if (!event || sending) return
    if (!size) { setError('Zvoľte prosím počet členov tímu.'); return }
    setSending(true)
    setError(undefined)
    const { data, error } = await supabase.rpc('register_team', {
      p_event_id: event.id, p_team_name: teamName, p_email: email, p_team_size: size, p_teaser_answer: teaser,
    })
    if (error) {
      setError(friendlyError(error.message))
      setSending(false)
      return
    }
    const reg = (data as { manage_token: string }[])[0]
    // potvrdenie e-mailom – ak zlyhá, registrácia aj tak platí
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
          {full && <p className="alert">Kapacita je naplnená. Zaradíme vás na čakaciu listinu a ozveme sa, ak sa uvoľní miesto.</p>}

          <label>
            Názov tímu
            <input required maxLength={60} value={teamName} onChange={(e) => setTeamName(e.target.value)} autoComplete="off" />
          </label>

          <label>
            E-mail
            <input required type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" />
          </label>

          <fieldset>
            <legend>Počet členov tímu</legend>
            <div className="size-options">
              {sizes.map((n) => (
                <label key={n} className={`size-option ${size === n ? 'selected' : ''}`}>
                  <input type="radio" name="size" value={n} checked={size === n} onChange={() => setSize(n)} required />
                  <span className="size-n">{n}</span>
                </label>
              ))}
            </div>
          </fieldset>

          {event.teaser_question && event.teaser_options && (
            <fieldset className="teaser">
              <legend>Malá ochutnávka: {event.teaser_question}</legend>
              {event.teaser_options.map((o, i) => (
                <label key={i} className="radio-row">
                  <input type="radio" name="teaser" checked={teaser === i} onChange={() => setTeaser(i)} /> {o}
                </label>
              ))}
            </fieldset>
          )}

          <label className="checkbox-row">
            <input type="checkbox" required checked={consent} onChange={(e) => setConsent(e.target.checked)} />
            <span>
              Súhlasím s <a href="/podmienky" target="_blank">podmienkami</a> a{' '}
              <a href="/ochrana-udajov" target="_blank">spracovaním osobných údajov</a>.
            </span>
          </label>

          {error && <p className="alert" role="alert">{error}</p>}

          <button className="button" disabled={sending}>{sending ? 'Odosielam…' : 'Registrovať tím'}</button>
        </form>
      )}
      <p className="center" style={{ marginTop: 16 }}><Link className="button button-ghost button-small" to="/">← Späť na úvod</Link></p>
    </article>
  )
}
