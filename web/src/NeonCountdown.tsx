import { useEffect, useState } from 'react'

// Neónový odpočet do začiatku kvízu (aktualizuje sa každých 20 s)
export function NeonCountdown({ startsAt }: { startsAt: string }) {
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 20_000); return () => clearInterval(t) }, [])
  const ms = new Date(startsAt).getTime() - now
  if (ms <= 0) return null
  const d = Math.floor(ms / 86_400_000)
  const h = Math.floor((ms % 86_400_000) / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const unit = (n: number, one: string, few: string, many: string) => (n === 1 ? one : n >= 2 && n <= 4 ? few : many)
  return (
    <div className="neon-countdown" aria-label={`Do kvízu zostáva ${d} dní ${h} hodín ${m} minút`}>
      <span className="nc-label">Do kvízu zostáva</span>
      <span className="nc-digits">
        {d > 0 && <><b>{d}</b><i>{unit(d, 'deň', 'dni', 'dní')}</i><em>:</em></>}
        <b>{String(h).padStart(2, '0')}</b><i>h</i><em>:</em>
        <b>{String(m).padStart(2, '0')}</b><i>min</i>
      </span>
    </div>
  )
}
