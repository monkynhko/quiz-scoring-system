// Vyhodnotenie odpoveďového hárku (fotka) cez Gemini. Spúšťa ho databáza (pg_net) hneď po odovzdaní,
// záchranná sieť (pg_cron) opakuje zaseknuté pokusy. Volanie je chránené zdieľaným tajomstvom.
import { createClient } from 'npm:@supabase/supabase-js@2'
import { encodeBase64 } from 'jsr:@std/encoding/base64'

const MODEL = Deno.env.get('GEMINI_MODEL') ?? 'gemini-2.5-flash'
const REVIEW_BELOW = 85 // istota AI pod touto hranicou → kontrola človekom

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

Deno.serve(async (req) => {
  if (req.headers.get('x-grade-secret') !== Deno.env.get('GRADE_SECRET')) return json({ error: 'forbidden' }, 403)
  const { submission_id } = await req.json().catch(() => ({}))
  if (typeof submission_id !== 'string') return json({ error: 'bad_input' }, 400)

  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)
  const fail = async (error: string) => {
    await db.from('answer_submissions').update({ ai_status: 'failed', ai_error: error.slice(0, 500) }).eq('id', submission_id)
    return json({ error }, 500)
  }

  const { data: sub } = await db.from('answer_submissions')
    .select('id, team_id, round_id, photo_path, status').eq('id', submission_id).maybeSingle()
  if (!sub) return json({ error: 'not_found' }, 404)
  if (sub.status !== 'pending') return json({ ok: true, skipped: sub.status })

  // správne odpovede kola: téma 1 = otázky 1–5, téma 2 = 6–10
  const { data: topics } = await db.from('round_topics')
    .select('id, topic_order, categories(name), correct_answers(question_number, correct_answer, accept_alternatives, ai_note)')
    .eq('round_id', sub.round_id).order('topic_order')
  const key: { n: number; topic: string; correct: string; alternatives: string[]; note: string | null }[] = []
  for (const t of topics ?? []) {
    const topicName = (t.categories as unknown as { name: string } | null)?.name ?? `Téma ${t.topic_order}`
    for (const ca of (t.correct_answers ?? []) as { question_number: number; correct_answer: string; accept_alternatives: string[] | null; ai_note: string | null }[]) {
      key.push({ n: (t.topic_order - 1) * 5 + ca.question_number, topic: topicName, correct: ca.correct_answer, alternatives: ca.accept_alternatives ?? [], note: ca.ai_note })
    }
  }
  key.sort((a, b) => a.n - b.n)
  if (key.length === 0) return fail('Chýbajú správne odpovede pre toto kolo.')

  const { data: file, error: dlErr } = await db.storage.from('answer-sheets').download(sub.photo_path)
  if (dlErr || !file) return fail('Fotka sa nedá stiahnuť: ' + (dlErr?.message ?? ''))
  const image = encodeBase64(new Uint8Array(await file.arrayBuffer()))

  const gemini = async (parts: unknown[], schema: unknown, thinking: number) => {
    const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': Deno.env.get('GEMINI_API_KEY')! },
      body: JSON.stringify({
        contents: [{ role: 'user', parts }],
        generationConfig: { temperature: 0, responseMimeType: 'application/json', responseSchema: schema, thinkingConfig: { thinkingBudget: thinking } },
      }),
      signal: AbortSignal.timeout(45_000),
    })
    if (!res.ok) throw new Error(`Gemini ${res.status}: ${(await res.text()).slice(0, 300)}`)
    const out = await res.json()
    return JSON.parse(out.candidates?.[0]?.content?.parts?.map((p: { text?: string }) => p.text ?? '').join('') ?? '{}')
  }
  const keyText = key.map((k) => `${k.n}. [${k.topic}] ${k.correct}${k.alternatives.length ? ` (uznať aj: ${k.alternatives.join(', ')})` : ''}${k.note ? ` – POKYN: ${k.note}` : ''}`).join('\n')
  const rules = `Pravidlá hodnotenia (nebuď prísny na formálne veci):
- Uznaj preklepy, chýbajúcu diakritiku, veľké/malé písmená, iný jazyk, synonymá, skratky a iné pomenovanie tej istej veci (napr. „Pacifik“ = „Tichý oceán“), aj odpoveď s nadbytočným, no pravdivým spresnením.
- Pri osobách stačí priezvisko, ak je jednoznačné. Pri číslach uznaj aj zápis s jednotkou alebo slovom.
- Ak tím napísal viac rôznych odpovedí naraz („A alebo B“), je to 0 bodov.
- Body: 1 = správne, 0 = nesprávne alebo prázdne, 0.5 = čiastočne správne (napr. pri hudbe iba interpret bez piesne, pri dvojdielnej odpovedi jedna časť). Ak POKYN hovorí inak, riaď sa POKYNOM.`

  // 1) z fotky: prečítať platnú odpoveď (prečiarknuté zvlášť) + prvé hodnotenie
  type Read = { question_number: number; answer: string; crossed_out: string; read_confidence: number; points: number; box_2d?: number[] }
  // 2) iba z textu: nezávislé hodnotenie prečítaných odpovedí
  type Judge = { question_number: number; points: number; reason: string; borderline: boolean }
  let reads: Read[], judged: Judge[]
  try {
    const r1 = await gemini([
      { inline_data: { mime_type: file.type || 'image/jpeg', data: image } },
      { text: `Na fotke je ručne vyplnený odpoveďový hárok tímu z pub kvízu (slovenčina), riadky 1. až 10.
Pre KAŽDÝ riadok podľa čísla na začiatku riadku:
- answer: platná odpoveď presne tak, ako je napísaná (bez prečiarknutého textu); prázdny riadok = "".
- crossed_out: prečiarknutý alebo škrtnutý text v tom riadku, inak "".
- read_confidence (0–100): ako si istý prečítaním rukopisu (pozor na zámeny 5/S, 1/l, 0/O – pomôž si zmyslom otázky).
- points: tvoje hodnotenie podľa správnych odpovedí nižšie.
- box_2d: oblasť riadku s odpoveďou ako [ymin, xmin, ymax, xmax] v rozsahu 0–1000.

Správne odpovede:
${keyText}

${rules}
Vráť presne 10 položiek pre otázky 1 až 10.` },
    ], {
      type: 'OBJECT', required: ['rows'],
      properties: { rows: { type: 'ARRAY', items: { type: 'OBJECT', required: ['question_number', 'answer', 'crossed_out', 'read_confidence', 'points'],
        properties: { question_number: { type: 'INTEGER' }, answer: { type: 'STRING' }, crossed_out: { type: 'STRING' }, read_confidence: { type: 'INTEGER' }, points: { type: 'NUMBER' }, box_2d: { type: 'ARRAY', items: { type: 'INTEGER' } } } } } },
    }, 1024)
    reads = r1.rows ?? []

    const pairs = key.map((k) => {
      const r = reads.find((x) => x.question_number === k.n)
      return `${k.n}. [${k.topic}] správne: ${k.correct}${k.alternatives.length ? ` (uznať aj: ${k.alternatives.join(', ')})` : ''}${k.note ? ` – POKYN: ${k.note}` : ''}\n    odpoveď tímu: "${r?.answer ?? ''}"`
    }).join('\n')
    const r2 = await gemini([{ text: `Si porotca pub kvízu. Ohodnoť odpovede tímu.\n\n${pairs}\n\n${rules}\n- reason: krátko po slovensky (max. 12 slov).\n- borderline = true, ak je rozhodnutie sporné.\nVráť presne 10 položiek.` }], {
      type: 'OBJECT', required: ['rows'],
      properties: { rows: { type: 'ARRAY', items: { type: 'OBJECT', required: ['question_number', 'points', 'reason', 'borderline'],
        properties: { question_number: { type: 'INTEGER' }, points: { type: 'NUMBER' }, reason: { type: 'STRING' }, borderline: { type: 'BOOLEAN' } } } } },
    }, 512)
    judged = r2.rows ?? []
  } catch (e) {
    return fail('AI chyba: ' + (e instanceof Error ? e.message : String(e)))
  }

  // aktuálne ešte platí? (tím mohol medzitým poslať novú fotku)
  const { data: still } = await db.from('answer_submissions').select('status').eq('id', submission_id).single()
  if (still?.status !== 'pending') return json({ ok: true, skipped: 'replaced' })

  const norm = (x: string) => x.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '')
  const valid = (p: unknown) => (p === 0 || p === 0.5 || p === 1 ? p : null)
  const rows = key.map((k) => {
    const r = reads.find((x) => x.question_number === k.n)
    const j = judged.find((x) => x.question_number === k.n)
    const answer = (r?.answer ?? '').trim()
    const exact = answer !== '' && [k.correct, ...k.alternatives].some((c) => norm(c) === norm(answer))
    const pA = valid(r?.points), pB = valid(j?.points)
    const points = exact ? 1 : (pB ?? pA ?? 0)
    const readConf = r ? Math.max(0, Math.min(100, r.read_confidence)) : 0
    const reasons: string[] = []
    if (!exact) {
      if (!r || !j) reasons.push('AI nevrátila hodnotenie')
      if (readConf < REVIEW_BELOW) reasons.push(`nečitateľné (${readConf} %)`)
      if (pA !== null && pB !== null && pA !== pB) reasons.push('AI sa nezhodla')
      if (points === 0.5) reasons.push('½ bodu')
      if (j?.borderline) reasons.push('sporné')
      if (!answer && (r?.crossed_out ?? '').trim()) reasons.push('iba prečiarknuté')
    }
    const box = r?.box_2d?.length === 4 ? r.box_2d : null
    return {
      submission_id, question_number: k.n,
      ocr_text: answer + ((r?.crossed_out ?? '').trim() ? `  (prečiarknuté: ${r!.crossed_out.trim()})` : ''),
      correct_answer: k.correct, points, is_correct: points > 0, confidence: readConf,
      reasoning: exact ? 'Presná zhoda.' : (j?.reason ?? null),
      needs_review: reasons.length > 0, review_reason: reasons.join(', ') || null, box,
      final_points: null, reviewed_by: null, reviewed_at: null, claimed_by: null, claimed_at: null,
    }
  })

  const { error: upErr } = await db.from('ai_evaluations').upsert(rows, { onConflict: 'submission_id,question_number' })
  if (upErr) return fail('Uloženie hodnotenia zlyhalo: ' + upErr.message)

  const total = rows.reduce((s, r) => s + r.points, 0)
  await db.from('answer_submissions').update({
    ai_status: 'completed', ai_processed_at: new Date().toISOString(), ai_score: Math.floor(total), ai_max_score: rows.length, ai_error: null,
  }).eq('id', submission_id)
  await db.rpc('recompute_team_round', { p_team_id: sub.team_id, p_round_id: sub.round_id })

  return json({ ok: true, total, review: rows.filter((r) => r.needs_review).length })
})
