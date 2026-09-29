import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

if (!url || !anonKey) {
  throw new Error('Chýba VITE_SUPABASE_URL alebo VITE_SUPABASE_ANON_KEY (web/.env.local)')
}

export const supabase = createClient(url, anonKey)

export type PublicEvent = {
  id: string
  slug: string
  title: string
  starts_at: string
  venue: string
  capacity_teams: number
  taken: number
  price_per_person_cents: number
  door_price_per_person_cents: number
  change_deadline_hours: number
  min_team_size: number
  max_team_size: number
  registration_open: boolean
  has_transfer: boolean
  teaser_question: string | null
  teaser_options: string[] | null
}

export type RegistrationView = {
  team_name: string
  team_size: number
  status: 'confirmed' | 'waitlist' | 'cancelled'
  payment_status: 'unpaid' | 'paid' | 'refunded'
  amount_cents: number
  paid_cents: number
  variable_symbol: string
  created_at: string
  teaser_answer: number | null
  event: {
    title: string
    starts_at: string
    venue: string
    payment_iban: string | null
    payment_beneficiary: string | null
    teaser: { question: string; options: string[]; correct: number } | null
    price_per_person_cents: number
    door_price_per_person_cents: number
    min_team_size: number
    max_team_size: number
    change_deadline: string
  }
  tickets: { seat_no: number; code: string; checked_in: boolean }[]
}

// Chyby z SQL funkcií (raise exception '...') → text pre používateľa
export function friendlyError(message: string | undefined): string {
  const m = message ?? ''
  if (m.includes('team_name_taken')) return 'Tím s týmto názvom je už prihlásený. Zvoľte prosím iný názov.'
  if (m.includes('registration_closed')) return 'Registrácia na tento kvíz je momentálne zatvorená.'
  if (m.includes('invalid_team_size')) return 'Neplatný počet členov tímu.'
  if (m.includes('event_not_found')) return 'Kvíz sa nenašiel.'
  if (m.includes('deadline_passed')) return 'Lehota na zníženie počtu alebo odhlásenie už uplynula.'
  if (m.includes('event_started')) return 'Kvíz už začal, zmeny nie sú možné.'
  if (m.includes('tickets_already_used')) return 'Niektorý z lístkov už bol použitý.'
  if (m.includes('email')) return 'Skontrolujte prosím e-mailovú adresu.'
  return 'Niečo sa pokazilo. Skúste to prosím znova, prípadne nám napíšte na FB alebo IG.'
}
