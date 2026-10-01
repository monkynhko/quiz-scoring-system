const TZ = 'Europe/Bratislava'

export const eur = (cents: number) =>
  new Intl.NumberFormat('sk-SK', { style: 'currency', currency: 'EUR', maximumFractionDigits: cents % 100 ? 2 : 0 }).format(cents / 100)

export const dateLong = (iso: string) =>
  new Intl.DateTimeFormat('sk-SK', { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso))

export const time = (iso: string) =>
  new Intl.DateTimeFormat('sk-SK', { timeZone: TZ, hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export const dateTimeShort = (iso: string) =>
  new Intl.DateTimeFormat('sk-SK', { timeZone: TZ, day: 'numeric', month: 'numeric', hour: '2-digit', minute: '2-digit' }).format(new Date(iso))

export const formatIban = (iban: string) => iban.replace(/\s+/g, '').replace(/(.{4})/g, '$1 ').trim()

export const pluralTeams = (n: number) => (n === 1 ? 'tím' : n >= 2 && n <= 4 ? 'tímy' : 'tímov')

// Nechceme ukazovať „35 z 35 voľných“ – pôsobí to, akoby nebol záujem
export function spotsText(free: number, capacity: number, taken: number) {
  if (free <= 0) return 'Kapacita je naplnená – môžete sa prihlásiť na čakaciu listinu.'
  if (free === 1) return 'Posledné voľné miesto.'
  if (free <= 4) return `Posledné ${free} voľné miesta.`
  if (free <= 10) return `Posledných ${free} voľných miest.`
  // sociálny dôkaz až od 10 tímov – pri malom počte radšej neutrálne
  if (taken >= 10) return `Prihlásených je už ${taken} tímov`
  return `Registrácia je otvorená · kapacita ${capacity} tímov`
}
