// „Naše hárky“: tím podľa tajného odkazu vidí svoje opravené hárky – iba zverejnené kolá, len na čítanie.
// Verejná funkcia (--no-verify-jwt); fotky sú v súkromnom úložisku, vydávame krátkodobé podpísané odkazy.
import { createClient } from 'npm:@supabase/supabase-js@2'

const cors = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...cors, 'Content-Type': 'application/json', 'Cache-Control': 'no-store' } })
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: cors })
  const { token } = await req.json().catch(() => ({}))
  if (typeof token !== 'string' || !UUID.test(token)) return json({ error: 'not_found' }, 404)
  const db = createClient(Deno.env.get('SUPABASE_URL')!, Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!)

  const { data: team } = await db.from('teams').select('id, name, quiz_id, quizzes(title)').eq('view_token', token).maybeSingle()
  if (!team) return json({ error: 'not_found' }, 404)

  const [{ data: rounds }, { data: subs }, { data: scores }] = await Promise.all([
    db.from('rounds').select('id, name, round_order, published_at, round_topics(id, topic_order, name, max_points, categories(name), correct_answers(question_number, correct_answer))')
      .eq('quiz_id', team.quiz_id).order('round_order'),
    db.from('answer_submissions').select('id, round_id, photo_path, submitted_at, ai_status')
      .eq('team_id', team.id).in('status', ['pending', 'reviewed']).order('submitted_at', { ascending: false }),
    db.from('scores').select('round_id, score').eq('team_id', team.id),
  ])
  const latest = new Map<string, { id: string; photo_path: string; submitted_at: string; ai_status: string }>()
  for (const s of subs ?? []) if (!latest.has(s.round_id)) latest.set(s.round_id, s)

  const out = []
  for (const r of rounds ?? []) {
    const sub = latest.get(r.id)
    const base = { id: r.id, name: r.name, order: r.round_order, submitted: !!sub, submitted_at: sub?.submitted_at ?? null }
    if (!r.published_at) { out.push({ ...base, published: false }); continue }

    type RT = { id: string; topic_order: number; name: string | null; max_points: number | null; categories: { name: string } | null; correct_answers: { question_number: number; correct_answer: string }[] }
    const topics = ((r.round_topics ?? []) as unknown as RT[]).sort((a, b) => a.topic_order - b.topic_order)
    const { data: ts } = await db.from('topic_scores').select('round_topic_id, score').eq('team_id', team.id).in('round_topic_id', topics.map((t) => t.id))
    const topicScore = new Map((ts ?? []).map((x) => [x.round_topic_id, Number(x.score)]))

    let answers: { n: number; written: string; correct: string; points: number | null }[] = []
    let photo: string | null = null
    if (sub) {
      const { data: evs } = await db.from('ai_evaluations').select('question_number, ocr_text, points, final_points').eq('submission_id', sub.id).order('question_number')
      const correct = new Map<number, string>()
      for (const t of topics) for (const c of t.correct_answers ?? []) correct.set((t.topic_order - 1) * 5 + c.question_number, c.correct_answer)
      answers = (evs ?? []).map((e) => ({ n: e.question_number, written: e.ocr_text ?? '', correct: correct.get(e.question_number) ?? '', points: e.final_points ?? e.points }))
      const signed = await db.storage.from('answer-sheets').createSignedUrl(sub.photo_path, 60 * 60)
      photo = signed.data?.signedUrl ?? null
    }
    out.push({
      ...base, published: true, photo, answers,
      score: (scores ?? []).find((s) => s.round_id === r.id)?.score ?? null,
      topics: topics.map((t) => ({ order: t.topic_order, name: t.name || t.categories?.name || `Téma ${t.topic_order}`, max: t.max_points ?? 5, score: topicScore.get(t.id) ?? null })),
    })
  }
  const total = (scores ?? []).filter((s) => out.some((r) => r.id === s.round_id && r.published)).reduce((a, s) => a + Number(s.score), 0)
  return json({ team: team.name, quiz: (team.quizzes as unknown as { title: string } | null)?.title ?? '', total, rounds: out })
})
