import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components'
import Home from './pages/Home'
import Register from './pages/Register'
import Privacy from './pages/Privacy'
import Terms from './pages/Terms'
import Shop from './pages/Shop'
import { Spinner } from './components'

// Lístky (QR + PAY by square) a administrácia sú väčšie – načítajú sa až keď treba
const Tickets = lazy(() => import('./pages/Tickets'))
const Admin = lazy(() => import('./pages/Admin'))
const Door = lazy(() => import('./pages/Door'))
const Grading = lazy(() => import('./pages/Grading'))
const Setup = lazy(() => import('./pages/Setup'))
const Submit = lazy(() => import('./pages/Submit'))
const Projector = lazy(() => import('./pages/Projector'))

export default function App() {
  return (
    <BrowserRouter>
      <Suspense fallback={<Spinner />}>
      <Routes>
        {/* projektor bez hlavičky a pätičky – na celé plátno */}
        <Route path="/projektor" element={<Projector />} />
        <Route path="*" element={<Site />} />
      </Routes>
      </Suspense>
    </BrowserRouter>
  )
}

function Site() {
  return (
      <Layout>
        <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/registracia/:slug" element={<Register />} />
          <Route path="/listky/:token" element={<Tickets />} />
          <Route path="/ochrana-udajov" element={<Privacy />} />
          <Route path="/podmienky" element={<Terms />} />
          <Route path="/vstupenky" element={<Shop />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/vstup" element={<Door />} />
          <Route path="/opravovanie" element={<Grading />} />
          <Route path="/priprava" element={<Setup />} />
          <Route path="/odovzdat" element={<Submit />} />
          <Route path="/live" element={<Projector big={false} />} />
          <Route path="*" element={<p className="card center">Stránka neexistuje.</p>} />
        </Routes>
        </Suspense>
      </Layout>
  )
}
