// Zverejnenie príspevku (obrázok + text) na FB stránku a Instagram. Volá iba admin z administrácie
// po kontrole náhľadu. Token stránky je trvalý (Supabase secret META_PAGE_TOKEN).
import { createClient } from 'npm:@supabase/supabase-js@2'

const G = 'https://graph.facebook.com/v26.0'
const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type' }
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

async function graph(path: string, params: Record<string, string>, method = 'POST') {
  const body = new URLSearchParams({ ...params, access_token: Deno.env.get('META_PAGE_TOKEN')! })
  const res = method === 'GET' ? await fetch(`${G}/${path}?${body}`) : await fetch(`${G}/${path}`, { method, body })
  const data = await res.json()
  if (data.error) throw new Error(data.error.error_user_msg || data.error.message)
  return data
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
  const { data: { user } } = await db.auth.getUser(jwt)
  const { data: prof } = user ? await db.from('profiles').select('is_admin').eq('id', user.id).maybeSingle() : { data: null }
  if (!prof?.is_admin) return json({ error: 'forbidden' }, 403)

  const { event_id, caption, image_path, targets } = await req.json().catch(() => ({}))
  if (typeof caption !== 'string' || !caption.trim() || typeof image_path !== 'string' || !image_path.startsWith('posts/')) return json({ error: 'bad_input' }, 400)
  const want = new Set<string>(Array.isArray(targets) ? targets : ['fb', 'ig'])
  const imageUrl = db.storage.from('social').getPublicUrl(image_path).data.publicUrl

  const { data: row } = await db.from('social_posts').insert({ event_id: event_id ?? null, caption, image_path, created_by: user!.id }).select('id').single()
  const errors: string[] = []
  let fb: string | null = null, ig: string | null = null

  if (want.has('fb')) {
    try { fb = (await graph(`${Deno.env.get('META_PAGE_ID')}/photos`, { url: imageUrl, caption })).post_id ?? null }
    catch (e) { errors.push('Facebook: ' + (e as Error).message) }
  }
  if (want.has('ig')) {
    try {
      const igUser = Deno.env.get('META_IG_USER_ID')!
      const container = await graph(`${igUser}/media`, { image_url: imageUrl, caption })
      // Instagram si obrázok spracuje – počkáme na FINISHED (max. ~30 s)
      for (let i = 0; i < 15; i++) {
        const s = await graph(container.id, { fields: 'status_code' }, 'GET')
        if (s.status_code === 'FINISHED') break
        if (s.status_code === 'ERROR') throw new Error('Instagram nevedel spracovať obrázok')
        await new Promise((r) => setTimeout(r, 2000))
      }
      ig = (await graph(`${igUser}/media_publish`, { creation_id: container.id })).id
    } catch (e) { errors.push('Instagram: ' + (e as Error).message) }
  }

  const status = errors.length === 0 ? 'published' : (fb || ig) ? 'partial' : 'failed'
  await db.from('social_posts').update({ fb_post_id: fb, ig_media_id: ig, status, error: errors.join(' | ') || null }).eq('id', row!.id)
  return json({ status, fb_post_id: fb, ig_media_id: ig, errors })
})
