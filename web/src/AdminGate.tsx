import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Spinner } from './components'

// Obsah iba pre prihláseného admina (profiles.is_admin); inak prihlásenie cez e-mailový odkaz
export function AdminGate({ children, allow = 'admin' }: { children: (email: string, role: 'admin' | 'door') => React.ReactNode; allow?: 'admin' | 'staff' }) {
  const [session, setSession] = useState<Session | null>()
  const [role, setRole] = useState<'admin' | 'door' | null>()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    // offline: ak už raz bol overený ako admin na tomto zariadení, pustíme ho (dáta aj tak chráni RLS)
    const cacheKey = `admin:${session.user.id}`
    supabase.from('profiles').select('is_admin, role').eq('id', session.user.id).maybeSingle().then(({ data, error }) => {
      if (error) { setRole((localStorage.getItem(cacheKey) as 'admin' | 'door' | null) || null); return }
      const r = data?.is_admin ? 'admin' : data?.role === 'door' ? 'door' : null
      setRole(r)
      try { if (r) localStorage.setItem(cacheKey, r); else localStorage.removeItem(cacheKey) } catch { /* ignore */ }
    })
  }, [session])

  if (session === undefined) return <Spinner />
  if (!session) return <Login />
  if (role === undefined) return <Spinner />
  if (!role || (allow === 'admin' && role !== 'admin')) return (
    <p className="card center">
      Účet {session.user.email} nemá prístup{role === 'door' ? ' do administrácie. ' : '. '}
      {role === 'door' && <><a href="/vstup">Prejsť na vstup</a> · </>}
      <button className="link" onClick={() => supabase.auth.signOut()}>Odhlásiť</button>
    </p>
  )
  return <>{children(session.user.email ?? '', role)}</>
}

function Login() {
  const [email, setEmail] = useState('')
  const [sent, setSent] = useState(false)
  const [error, setError] = useState<string>()
  async function submit(e: React.FormEvent) {
    e.preventDefault()
    const { error } = await supabase.auth.signInWithOtp({ email, options: { emailRedirectTo: location.href, shouldCreateUser: false } })
    if (error) setError(error.message)
    else setSent(true)
  }
  return (
    <article className="card narrow">
      <h1>Prihlásenie organizátora</h1>
      {sent ? <p>Poslali sme prihlasovací odkaz na <strong>{email}</strong>. Otvorte ho na tomto zariadení.</p> : (
        <form onSubmit={submit} className="form">
          <label>E-mail<input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} /></label>
          {error && <p className="alert">{error}</p>}
          <button className="button">Poslať prihlasovací odkaz</button>
        </form>
      )}
    </article>
  )
}
