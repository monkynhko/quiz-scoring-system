import { Link } from 'react-router-dom'

export default function Shop() {
  return (
    <article className="card center">
      <h1>Vstupenky online</h1>
      <p className="lead">🚧 Online predaj vstupeniek je momentálne vo výstavbe.</p>
      <p>Po spustení vás budeme informovať – kúpou vstupeniek vopred ušetríte čas pri vstupe.</p>
      <p className="muted">Zatiaľ stačí zaregistrovať tím, vstupné sa platí na mieste.</p>
      <Link className="button" to="/">Späť na registráciu tímu</Link>
    </article>
  )
}
