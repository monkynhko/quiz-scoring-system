import { lazy, Suspense } from 'react'
import { BrowserRouter, Route, Routes } from 'react-router-dom'
import { Layout } from './components'
import Home from './pages/Home'
import Register from './pages/Register'
import Privacy from './pages/Privacy'
import { Spinner } from './components'

// Lístky (QR + PAY by square) a administrácia sú väčšie – načítajú sa až keď treba
const Tickets = lazy(() => import('./pages/Tickets'))
const Admin = lazy(() => import('./pages/Admin'))
const Door = lazy(() => import('./pages/Door'))

export default function App() {
  return (
    <BrowserRouter>
      <Layout>
        <Suspense fallback={<Spinner />}>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/registracia/:slug" element={<Register />} />
          <Route path="/listky/:token" element={<Tickets />} />
          <Route path="/ochrana-udajov" element={<Privacy />} />
          <Route path="/admin" element={<Admin />} />
          <Route path="/vstup" element={<Door />} />
          <Route path="*" element={<p className="card center">Stránka neexistuje.</p>} />
        </Routes>
        </Suspense>
      </Layout>
    </BrowserRouter>
  )
}
