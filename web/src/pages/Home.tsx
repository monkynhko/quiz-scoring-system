import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type PublicEvent } from '../lib/supabase'
import { dateLong, spotsText, time } from '../lib/format'
import { Spinner } from '../components'

export default function Home() {
  const [events, setEvents] = useState<PublicEvent[]>()
  const [error, setError] = useState(false)

  useEffect(() => {
    supabase.rpc('public_events').then(({ data, error }) => {
      if (error) setError(true)
      else setEvents(data as PublicEvent[])
    })
  }, [])

  return (
    <>
      <section className="hero">
        <h1>Vedomostno-zábavný kvíz</h1>
        <p className="lead">Tímy po 4–6 ľuďoch, 5 kôl, 10 tém a jeden víťaz.</p>
      </section>

      {error && <p className="alert">Nepodarilo sa načítať kvízy. Skúste obnoviť stránku.</p>}
      {!events && !error && <Spinner />}
      {events?.length === 0 && <p className="card center">Najbližší kvíz ešte nie je vypísaný. Sledujte nás na sociálnych sieťach.</p>}

      {events?.map((e) => {
        const free = Math.max(e.capacity_teams - e.taken, 0)
        return (
          <article key={e.id} className="card event-card">
            <h2>{e.title}</h2>
            <p className="event-meta">
              <strong>{dateLong(e.starts_at)}</strong> o {time(e.starts_at)} · {e.venue}
            </p>
            {e.registration_open ? (
              <>
                <p className={free > 0 ? 'spots' : 'spots spots-full'}>
                  {spotsText(free, e.capacity_teams)}
                </p>
                <div className="cta-row">
                  <Link className="button" to={`/registracia/${e.slug}`}>
                    {free > 0 ? 'Registrovať tím' : 'Na čakaciu listinu'}
                  </Link>
                  <Link className="button button-ghost" to="/vstupenky">Kúpiť vstupenky</Link>
                </div>
              </>
            ) : (
              <p className="muted">Registrácia zatiaľ nie je otvorená.</p>
            )}
          </article>
        )
      })}

      <p className="center muted small"><a href="/vysledky/">Výsledky a ligová tabuľka</a></p>
    </>
  )
}
