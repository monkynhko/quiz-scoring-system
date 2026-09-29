import { useEffect, useState } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './lib/supabase'
import { Spinner } from './components'

// Obsah iba pre prihláseného admina (profiles.is_admin); inak prihlásenie cez e-mailový odkaz
export function AdminGate({ children }: { children: (email: string) => React.ReactNode }) {
  const [session, setSession] = useState<Session | null>()
  const [isAdmin, setIsAdmin] = useState<boolean>()

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  useEffect(() => {
    if (!session) return
    // offline: ak už raz bol overený ako admin na tomto zariadení, pustíme ho (dáta aj tak chráni RLS)
    const cacheKey = `admin:${session.user.id}`
    supabase.from('profiles').select('is_admin').eq('id', session.user.id).maybeSingle().then(({ data, error }) => {
      if (error) setIsAdmin(localStorage.getItem(cacheKey) === '1')
      else {
        setIsAdmin(!!data?.is_admin)
        try { localStorage.setItem(cacheKey, data?.is_admin ? '1' : '0') } catch { /* ignore */ }
      }
    })
  }, [session])

  if (session === undefined) return <Spinner />
  if (!session) return <Login />
  if (isAdmin === undefined) return <Spinner />
  if (!isAdmin) return (
    <p className="card center">Účet {session.user.email} nemá administrátorské práva. <button className="link" onClick={() => supabase.auth.signOut()}>Odhlásiť</button></p>
  )
  return <>{children(session.user.email ?? '')}</>
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
