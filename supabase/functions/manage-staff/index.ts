// Správa organizátorov: zoznam, pridanie e-mailu s rolou, zmena roly, odobratie prístupu.
// Rolu Vstup spravuje každý admin, adminov pridáva / odoberá iba hlavný admin (is_owner).
// Registrácia nových účtov je v Supabase vypnutá – účty zakladá iba táto funkcia.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: { user: me } } = await admin.auth.getUser(jwt)
  const { data: myProfile } = me ? await admin.from('profiles').select('is_admin, is_owner').eq('id', me.id).maybeSingle() : { data: null }
  if (!me || !myProfile?.is_admin) return json({ error: 'forbidden' }, 403)

  const isOwner = !!myProfile.is_owner
  const body = await req.json().catch(() => ({}))
  const { action } = body

  if (action === 'list') {
    const { data: profiles } = await admin.from('profiles').select('id, email, role, is_admin, is_owner').or('role.not.is.null,is_admin.eq.true')
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    const lastLogin = new Map(users.map((u) => [u.id, u.last_sign_in_at]))
    return json({
      is_owner: isOwner,
      staff: (profiles ?? []).map((p) => ({ ...p, role: p.role ?? (p.is_admin ? 'admin' : null), last_sign_in_at: lastLogin.get(p.id) ?? null, me: p.id === me.id }))
        .sort((a, b) => (a.email ?? '').localeCompare(b.email ?? '')),
    })
  }

  if (action === 'add') {
    const email = String(body.email ?? '').trim().toLowerCase()
    const role = body.role
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) || !['admin', 'door'].includes(role)) return json({ error: 'bad_input' }, 400)
    if (role === 'admin' && !isOwner) return json({ error: 'owner_only' }, 403)
    const { data: { users } } = await admin.auth.admin.listUsers({ perPage: 1000 })
    let user = users.find((u) => u.email?.toLowerCase() === email)
    if (user) {
      // existujúceho admina nemôže bežný admin preradiť na Vstup
      const { data: existing } = await admin.from('profiles').select('is_admin, is_owner').eq('id', user.id).maybeSingle()
      if (existing?.is_owner) return json({ error: 'owner_protected' }, 403)
      if (existing?.is_admin && !isOwner) return json({ error: 'owner_only' }, 403)
    }
    if (!user) {
      const { data, error } = await admin.auth.admin.createUser({ email, email_confirm: true })
      if (error || !data.user) return json({ error: 'create_failed', detail: error?.message }, 500)
      user = data.user
    }
    const { error } = await admin.from('profiles').upsert({ id: user.id, email, role, is_admin: role === 'admin' })
    if (error) return json({ error: 'profile_failed', detail: error.message }, 500)
    return json({ ok: true })
  }

  if (action === 'set_role') {
    const { user_id, role } = body
    if (typeof user_id !== 'string' || ![null, 'admin', 'door'].includes(role)) return json({ error: 'bad_input' }, 400)
    if (user_id === me.id) return json({ error: 'cannot_change_self' }, 400)
    const { data: target } = await admin.from('profiles').select('is_admin, is_owner').eq('id', user_id).maybeSingle()
    if (!target) return json({ error: 'not_found' }, 404)
    if (target.is_owner) return json({ error: 'owner_protected' }, 403)
    if ((target.is_admin || role === 'admin') && !isOwner) return json({ error: 'owner_only' }, 403)
    const { error } = await admin.from('profiles').update({ role, is_admin: role === 'admin' }).eq('id', user_id)
    if (error) return json({ error: 'update_failed', detail: error.message }, 500)
    // po odobratí roly databáza (is_staff / is_admin) okamžite odmietne každú ďalšiu akciu
    return json({ ok: true })
  }

  return json({ error: 'bad_action' }, 400)
})
