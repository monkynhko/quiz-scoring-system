import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { supabase, type PublicEvent } from '../lib/supabase'
import { dateLong, eur, spotsText, time } from '../lib/format'
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
        <p className="lead">Tímy po 4–6 ľuďoch, 5 kôl, 10 tém a jeden víťaz. Prihláste svoj tím online a na vstupe už len ukážete lístky.</p>
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
            <p>Vstupné {eur(e.price_per_person_cents)} za osobu.</p>
            {e.registration_open ? (
              <>
                <p className={free > 0 ? 'spots' : 'spots spots-full'}>
                  {spotsText(free)}
                </p>
                <Link className="button" to={`/registracia/${e.slug}`}>
                  {free > 0 ? 'Prihlásiť tím' : 'Na čakaciu listinu'}
                </Link>
              </>
            ) : (
              <p className="muted">Registrácia zatiaľ nie je otvorená.</p>
            )}
          </article>
        )
      })}

      <p className="center muted small"><a href="https://monkynhko.github.io/quiz-scoring-system/leaderboard.html">Výsledky a ligová tabuľka</a></p>
    </>
  )
}
