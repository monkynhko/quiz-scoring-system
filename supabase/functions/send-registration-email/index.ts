// E-maily pre kapitána tímu:
//  kind = 'registration' – potvrdenie registrácie + pokyny k platbe (verejné volanie hneď po registrácii, iba raz, do 1 h)
//  kind = 'tickets'      – lístky po zaplatení (iba admin)
//  kind = 'reminder'     – výzva „Potvrďte účasť“ pred kvízom (iba admin)
// resend: true – opakované odoslanie (iba admin)
import { createClient } from 'npm:@supabase/supabase-js@2'

const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://kvizfactory.sk'
const FROM = Deno.env.get('MAIL_FROM') ?? 'Kvíz Factory <registracia@kvizfactory.sk>'
const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json' } })

const esc = (s: string) => s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]!)
const eur = (cents: number) => new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR' }).format(cents / 100)
const when = (iso: string) =>
  new Intl.DateTimeFormat('sk-SK', { timeZone: 'Europe/Bratislava', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))
const people = (n: number) => (n === 1 ? 'osoba' : n <= 4 ? 'osoby' : 'osôb')

// farby z loga
const C = { bg: '#0e0a1c', card: '#1a1134', line: '#3b2a6e', text: '#f6efff', muted: '#b3a6d9', pink: '#fa14c3', pinkSoft: '#ff5fdc', yellow: '#ffd23f' }

function layout(title: string, body: string) {
  return `<!doctype html><html lang="sk"><head><meta name="color-scheme" content="dark"><meta name="supported-color-schemes" content="dark"></head>
<body style="margin:0;padding:0;background:${C.bg};font-family:Arial,Helvetica,sans-serif;color:${C.text}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${C.bg}"><tr><td align="center" style="padding:20px 12px">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:560px">
    <tr><td align="center"><img src="${SITE_URL}/logo-email.jpg" width="560" alt="Kvíz Factory" style="display:block;width:100%;max-width:560px;height:auto;border-radius:16px 16px 0 0"></td></tr>
    <tr><td style="background:${C.card};border:1px solid ${C.line};border-top:0;border-radius:0 0 16px 16px;padding:24px">
      <h1 style="margin:0 0 12px;font-size:22px;color:${C.pinkSoft}">${title}</h1>
      ${body}
      <p style="font-size:12px;color:${C.muted};margin:24px 0 0;border-top:1px solid ${C.line};padding-top:14px">
        Zmeny alebo odhlásenie tímu nám dajte vedieť cez Facebook alebo Instagram Kvíz Factory.<br>SP Factory s.r.o. · <a href="${SITE_URL}/ochrana-udajov" style="color:${C.muted}">Ochrana osobných údajov</a>
      </p>
    </td></tr>
  </table>
</td></tr></table></body></html>`
}

const button = (href: string, label: string) =>
  `<p style="text-align:center;margin:22px 0"><a href="${href}" style="background:${C.pink};color:#fff;text-decoration:none;font-weight:bold;padding:13px 26px;border-radius:999px;display:inline-block">${label}</a></p>`

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { token, resend, kind = 'registration' } = await req.json().catch(() => ({}))
  if (typeof token !== 'string' || !/^[0-9a-f-]{36}$/i.test(token)) return json({ error: 'bad_token' }, 400)
  if (!['registration', 'tickets', 'reminder'].includes(kind)) return json({ error: 'bad_kind' }, 400)

  const admin = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  if (resend || kind !== 'registration') {
    const jwt = req.headers.get('Authorization')?.replace('Bearer ', '') ?? ''
    const { data: { user } } = await admin.auth.getUser(jwt)
    const { data: profile } = user ? await admin.from('profiles').select('is_admin').eq('id', user.id).maybeSingle() : { data: null }
    if (!profile?.is_admin) return json({ error: 'forbidden' }, 403)
  }

  const { data: reg } = await admin
    .from('registrations')
    .select('id, team_name, email, team_size, status, amount_cents, paid_cents, variable_symbol, payment_status, email_sent_at, created_at, events(title, starts_at, venue, shop_open, payment_iban, payment_beneficiary, door_price_per_person_cents, change_deadline_hours)')
    .eq('manage_token', token)
    .maybeSingle()
  if (!reg) return json({ error: 'not_found' }, 404)
  if (!resend && kind === 'registration') {
    if (reg.email_sent_at) return json({ ok: true, skipped: 'already_sent' })
    if (Date.now() - new Date(reg.created_at).getTime() > 60 * 60 * 1000) return json({ error: 'too_late' }, 400)
  }
  if (kind === 'tickets' && reg.payment_status !== 'paid') return json({ error: 'not_paid' }, 400)
  if (kind === 'reminder' && reg.status !== 'confirmed') return json({ error: 'not_confirmed' }, 400)

  const ev = reg.events as unknown as { title: string; starts_at: string; venue: string; shop_open: boolean; payment_iban: string | null; payment_beneficiary: string | null; door_price_per_person_cents: number; change_deadline_hours: number }
  const link = `${SITE_URL}/listky/${token}`
  const info = `<p style="margin:0 0 14px;color:${C.muted};line-height:1.5"><b style="color:${C.text};font-size:17px">${esc(reg.team_name)}</b> · ${reg.team_size} ${people(reg.team_size)}<br>
    ${esc(ev.title)}<br><b style="color:${C.text}">${esc(when(ev.starts_at))}</b> · ${esc(ev.venue)}</p>`
  const due = reg.amount_cents - reg.paid_cents

  let subject: string, html: string
  if (kind === 'reminder') {
    subject = `Potvrďte účasť – ${reg.team_name} | ${ev.title}`
    const btn = (href: string, label: string, bg: string) =>
      `<a href="${href}" style="background:${bg};color:#fff;text-decoration:none;font-weight:bold;padding:12px 18px;border-radius:999px;display:inline-block;margin:4px">${label}</a>`
    html = layout('Prídete na kvíz?', `${info}
      <p style="margin:0;line-height:1.5">Kvíz sa blíži! Dajte nám prosím vedieť, či prídete – kapacita je obmedzená a ak nemôžete, uvoľníme miesto ďalšiemu tímu.</p>
      <p style="text-align:center;margin:22px 0">
        ${btn(`${link}?ucast=ano`, '✅ Prídeme', '#1f9d61')}
        ${btn(`${link}#zmena`, 'Zmeniť počet', C.line)}
        ${btn(`${link}?ucast=nie`, '❌ Neprídeme', '#c0344d')}
      </p>`)
  } else if (kind === 'tickets') {
    subject = `Vaše lístky – ${reg.team_name} | ${ev.title}`
    html = layout('Platba prijatá, tu sú vaše lístky!', `${info}
      <p style="margin:0;line-height:1.5">Každý člen tímu ukáže pri vstupe svoj QR lístok. Lístky rozpošlete priamo zo stránky tlačidlom „Poslať“.</p>
      <p style="margin:14px 0 0;font-size:13px;color:${C.muted};line-height:1.5">Počet členov môžete zmeniť alebo registráciu zrušiť do ${esc(when(new Date(new Date(ev.starts_at).getTime() - ev.change_deadline_hours * 3600e3).toISOString()))}. Potom už môžete členov len pridať.</p>
      ${button(link, 'Zobraziť lístky')}`)
  } else if (reg.status === 'waitlist') {
    subject = `Čakacia listina – ${reg.team_name} | ${ev.title}`
    html = layout('Ste na čakacej listine', `${info}
      <p style="margin:0;line-height:1.5">Kapacita je momentálne naplnená. Ak sa uvoľní miesto, ozveme sa vám e-mailom.</p>`)
  } else {
    subject = `Registrácia prijatá – ${reg.team_name} | ${ev.title}`
    const payment = ev.shop_open && ev.payment_iban
      ? `<p style="margin:0 0 8px;line-height:1.5">Na úhradu: <b style="color:${C.yellow};font-size:18px">${eur(due)}</b>. Najjednoduchšie je naskenovať QR kód na platbu na stránke registrácie, alebo zadajte platbu ručne:</p>
         <table role="presentation" cellpadding="0" cellspacing="0" style="font-size:14px;color:${C.text};margin:0 0 6px">
           <tr><td style="padding:3px 14px 3px 0;color:${C.muted}">IBAN</td><td><b>${esc(ev.payment_iban.replace(/(.{4})/g, '$1 ').trim())}</b></td></tr>
           <tr><td style="padding:3px 14px 3px 0;color:${C.muted}">Príjemca</td><td>${esc(ev.payment_beneficiary ?? '')}</td></tr>
           <tr><td style="padding:3px 14px 3px 0;color:${C.muted}">Variabilný symbol</td><td><b>${esc(reg.variable_symbol)}</b></td></tr>
           <tr><td style="padding:3px 14px 3px 0;color:${C.muted}">Suma</td><td><b>${eur(due)}</b></td></tr>
         </table>
         <p style="margin:8px 0 0;line-height:1.5">Po pripísaní platby vám pošleme lístky s QR kódmi.</p>`
      : `<p style="margin:0;line-height:1.5"><b style="color:${C.yellow}">Nezabudnite si kúpiť vstupenky, aby ste nemuseli stáť v rade!</b><br><i style="color:${C.muted}">Samozrejme, hneď ako to bude možné 🙂</i></p>`
    const deadline = when(new Date(new Date(ev.starts_at).getTime() - ev.change_deadline_hours * 3600e3).toISOString())
    const rules = `<p style="margin:14px 0 0;font-size:13px;color:${C.muted};line-height:1.5">
      Počet členov môžete zmeniť alebo registráciu zrušiť cez odkaz nižšie do <b style="color:${C.text}">${esc(deadline)}</b>. Potom už môžete členov len pridať.</p>`
    html = layout('Registrácia prijatá!', `${info}${payment}${rules}${button(link, 'Moja registrácia')}`)
  }

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${Deno.env.get('RESEND_API_KEY')}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: FROM, to: [reg.email], subject, html }),
  })
  if (!r.ok) return json({ error: 'send_failed', detail: await r.text() }, 502)

  if (kind === 'registration') await admin.from('registrations').update({ email_sent_at: new Date().toISOString() }).eq('id', reg.id)
  if (kind === 'reminder') await admin.from('registrations').update({ reminder_sent_at: new Date().toISOString() }).eq('id', reg.id)
  return json({ ok: true })
})
