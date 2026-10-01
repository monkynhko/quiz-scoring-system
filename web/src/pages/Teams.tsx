import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { supabase, type PublicEvent } from '../lib/supabase'
import { dateLong, time } from '../lib/format'
import { Spinner } from '../components'

// Verejný zoznam prihlásených tímov (iba názvy). Bez slugu → najbližší kvíz.
export default function Teams() {
  const { slug } = useParams()
  const [event, setEvent] = useState<PublicEvent | null>()
  const [names, setNames] = useState<string[]>()

  useEffect(() => {
    (async () => {
      const { data } = slug ? await supabase.rpc('event_by_slug', { p_slug: slug }) : await supabase.rpc('public_events')
      const e = ((data ?? []) as PublicEvent[])[0] ?? null
      setEvent(e)
      if (!e) { setNames([]); return }
      const { data: t } = await supabase.rpc('event_team_names', { p_slug: e.slug })
      setNames(((t ?? []) as { team_name: string }[]).map((x) => x.team_name))
    })()
  }, [slug])

  if (event === undefined || names === undefined) return <Spinner />
  if (!event) return <p className="card center">Momentálne nie je vypísaný žiadny kvíz.</p>
  return (
    <article className="card">
      <h1>Prihlásené tímy</h1>
      <p className="event-meta">{event.title} · <strong>{dateLong(event.starts_at)}</strong> o {time(event.starts_at)} · {event.venue}</p>
      {names.length === 0 ? <p className="muted">Zatiaľ sa neprihlásil žiadny tím. Buďte prví!</p> : (
        <ol className="team-list">{names.map((n, i) => <li key={i}>{n}</li>)}</ol>
      )}
      {event.registration_open && (
        <p className="center"><Link className="button" to={`/registracia/${event.slug}`}>Registrovať tím</Link></p>
      )}
      <p className="center" style={{ marginTop: 12 }}><Link className="button button-ghost button-small" to="/">← Späť na úvod</Link></p>
    </article>
  )
}
