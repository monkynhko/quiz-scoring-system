// Obrázok príspevku na FB/IG (1080×1350) v štýle loga: tehlová stena, logo, neónový dátum a miesto.
export type SocialImageData = { dateLine: string; timeVenue: string; headline: string; footer: string }

const load = (src: string) => new Promise<HTMLImageElement>((res, rej) => { const i = new Image(); i.crossOrigin = 'anonymous'; i.onload = () => res(i); i.onerror = rej; i.src = src })

function neon(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, font: string, core: string, glow: string, maxWidth = 960) {
  ctx.font = font
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  let size = parseInt(font.match(/(\d+)px/)![1])
  while (ctx.measureText(text).width > maxWidth && size > 20) { size -= 2; ctx.font = font.replace(/\d+px/, `${size}px`) }
  for (const [blur, alpha] of [[40, 0.55], [18, 0.8], [6, 1]] as const) {
    ctx.shadowColor = glow; ctx.shadowBlur = blur; ctx.globalAlpha = alpha
    ctx.fillStyle = glow; ctx.fillText(text, x, y)
  }
  ctx.globalAlpha = 1; ctx.shadowBlur = 4; ctx.shadowColor = glow
  ctx.fillStyle = core; ctx.fillText(text, x, y)
  ctx.shadowBlur = 0
}

async function background(canvas: HTMLCanvasElement, base: string) {
  const W = 1080, H = 1350
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  // Inter musí byť načítaný skôr, než kreslíme (inak canvas použije náhradné písmo)
  await Promise.all(['800 64px Inter', '700 56px Inter', '600 40px Inter'].map((f) => document.fonts?.load(f).catch(() => null)))
  const [bricks, logo] = await Promise.all([load(`${base}/bricks.webp`), load(`${base}/logo.webp`)])
  // tehly cez celú plochu
  ctx.fillStyle = '#0e0a1c'; ctx.fillRect(0, 0, W, H)
  const tw = 1400, th = bricks.height * (1400 / bricks.width)
  for (let y = 0; y < H; y += th) ctx.drawImage(bricks, (W - tw) / 2, y, tw, th)
  // stmavenie + farebné žiary (ako na webe)
  const g = ctx.createLinearGradient(0, 0, 0, H)
  g.addColorStop(0, 'rgba(14,10,28,0.25)'); g.addColorStop(0.55, 'rgba(14,10,28,0.6)'); g.addColorStop(1, 'rgba(14,10,28,0.92)')
  ctx.fillStyle = g; ctx.fillRect(0, 0, W, H)
  for (const [x, y, r, c] of [[540, 300, 520, 'rgba(250,20,195,0.22)'], [700, 360, 420, 'rgba(59,108,255,0.20)']] as const) {
    const rg = ctx.createRadialGradient(x, y, 0, x, y, r); rg.addColorStop(0, c); rg.addColorStop(1, 'rgba(0,0,0,0)')
    ctx.fillStyle = rg; ctx.fillRect(0, 0, W, H)
  }
  return { ctx, W, H, logo }
}

export async function drawSocialImage(canvas: HTMLCanvasElement, d: SocialImageData, base = '') {
  const { ctx, W, logo } = await background(canvas, base)
  // logo
  const lw = 820, lh = logo.height * (lw / logo.width)
  ctx.drawImage(logo, (W - lw) / 2, 40, lw, lh)
  // texty
  const top = 40 + lh + 40
  neon(ctx, d.headline, W / 2, top, '800 64px Inter, system-ui, sans-serif', '#ffe3f8', '#fa14c3')
  neon(ctx, d.dateLine, W / 2, top + 150, '800 96px Inter, system-ui, sans-serif', '#fff6cf', '#ffd23f')
  neon(ctx, d.timeVenue, W / 2, top + 260, '700 56px Inter, system-ui, sans-serif', '#ffffff', '#b06bff')
  // rámik s výzvou
  const by = top + 380
  ctx.strokeStyle = '#fa14c3'; ctx.lineWidth = 5; ctx.shadowColor = '#fa14c3'; ctx.shadowBlur = 22
  ctx.beginPath(); ctx.roundRect(150, by, 780, 120, 60); ctx.stroke(); ctx.shadowBlur = 0
  neon(ctx, d.footer, W / 2, by + 62, '800 52px Inter, system-ui, sans-serif', '#ffffff', '#fa14c3', 700)
  return canvas
}

// ---------------------------------------------------------------- výsledky kvízu: pódium + ďalšie miesta
export type ResultRow = { place: number; team: string; total: number }
export type ResultsImageData = { title: string; rows: ResultRow[]; teams: number; footer: string }

const pts = (n: number) => (Number.isInteger(n) ? String(n) : String(n).replace('.5', '½'))

function fitText(ctx: CanvasRenderingContext2D, text: string, font: string, maxWidth: number) {
  let size = parseInt(font.match(/(\d+)px/)![1])
  ctx.font = font
  while (ctx.measureText(text).width > maxWidth && size > 18) { size -= 2; ctx.font = font.replace(/\d+px/, `${size}px`) }
  return size
}

function wrap2(ctx: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  if (ctx.measureText(text).width <= maxWidth) return [text]
  const words = text.split(' ')
  for (let i = words.length - 1; i > 0; i--) {
    const a = words.slice(0, i).join(' '), b = words.slice(i).join(' ')
    if (ctx.measureText(a).width <= maxWidth && ctx.measureText(b).width <= maxWidth) return [a, b]
  }
  return [text]
}

function medal(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, n: number) {
  const c = [['#fff3b0', '#ffd23f', '#b8860b'], ['#ffffff', '#cfd6e6', '#7d8597'], ['#ffd2b0', '#d9894f', '#8a4b1f']][n - 1]
  // stužka
  ctx.fillStyle = '#fa14c3'
  ctx.beginPath(); ctx.moveTo(x - r * 0.55, y - r * 1.9); ctx.lineTo(x - r * 0.1, y - r * 0.6); ctx.lineTo(x - r * 0.75, y - r * 0.6); ctx.closePath(); ctx.fill()
  ctx.fillStyle = '#b06bff'
  ctx.beginPath(); ctx.moveTo(x + r * 0.55, y - r * 1.9); ctx.lineTo(x + r * 0.1, y - r * 0.6); ctx.lineTo(x + r * 0.75, y - r * 0.6); ctx.closePath(); ctx.fill()
  // kotúč
  const g = ctx.createRadialGradient(x - r * 0.35, y - r * 0.35, r * 0.1, x, y, r)
  g.addColorStop(0, c[0]); g.addColorStop(0.55, c[1]); g.addColorStop(1, c[2])
  ctx.shadowColor = c[1]; ctx.shadowBlur = 30
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill()
  ctx.shadowBlur = 0
  ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, Math.PI * 2); ctx.stroke()
  ctx.fillStyle = c[2]; ctx.font = `800 ${Math.round(r * 1.05)}px Inter, system-ui, sans-serif`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
  ctx.fillText(String(n), x, y + 2)
}

export async function drawResultsImage(canvas: HTMLCanvasElement, d: ResultsImageData, base = '') {
  const { ctx, W, logo } = await background(canvas, base)
  const lw = 440, lh = logo.height * (lw / logo.width)
  ctx.drawImage(logo, (W - lw) / 2, 6, lw, lh)
  let y = 6 + lh + 18
  neon(ctx, d.title, W / 2, y, '800 60px Inter, system-ui, sans-serif', '#fff6cf', '#ffd23f')

  // pódium: 2. vľavo, 1. v strede, 3. vpravo (pri delených miestach rozhoduje poradie v zozname)
  const podium = [d.rows[1], d.rows[0], d.rows[2]]
  const colW = 300, gap = 24, x0 = (W - (colW * 3 + gap * 2)) / 2
  const heights = [150, 200, 120]
  const baseY = 830
  podium.forEach((r, i) => {
    if (!r) return
    const x = x0 + i * (colW + gap), h = heights[i], top = baseY - h
    // stupeň
    const g = ctx.createLinearGradient(0, top, 0, baseY)
    g.addColorStop(0, 'rgba(250,20,195,0.35)'); g.addColorStop(1, 'rgba(40,20,90,0.85)')
    ctx.fillStyle = g; ctx.strokeStyle = i === 1 ? '#ffd23f' : '#fa14c3'; ctx.lineWidth = 4
    ctx.shadowColor = ctx.strokeStyle as string; ctx.shadowBlur = 24
    ctx.beginPath(); ctx.roundRect(x, top, colW, h, [18, 18, 0, 0]); ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0
    neon(ctx, `${pts(r.total)} b.`, x + colW / 2, top + 52, '800 46px Inter, system-ui, sans-serif', '#ffffff', '#ffd23f', colW - 30)
    // medaila + meno nad stupňom
    const mr = i === 1 ? 54 : 44
    medal(ctx, x + colW / 2, top - mr - 26, mr, r.place)
    ctx.font = '800 38px Inter, system-ui, sans-serif'
    let size = 38
    let lines = wrap2(ctx, r.team, colW - 10)
    while (lines.some((l) => ctx.measureText(l).width > colW - 10) && size > 22) { size -= 2; ctx.font = `800 ${size}px Inter, system-ui, sans-serif`; lines = wrap2(ctx, r.team, colW - 10) }
    const nameBottom = top - mr - 26 - mr * 1.9 - 30
    lines.forEach((l, j) => neon(ctx, l, x + colW / 2, nameBottom - (lines.length - 1 - j) * (size + 6), `800 ${size}px Inter, system-ui, sans-serif`, '#ffffff', i === 1 ? '#ffd23f' : '#fa14c3', colW - 10))
  })

  // ďalšie miesta (4.–10.)
  const rest = d.rows.slice(3, 10)
  y = baseY + 36
  const rowH = 54, tx = 150, tw = W - 300
  rest.forEach((r, i) => {
    const ry = y + i * rowH
    ctx.fillStyle = i % 2 ? 'rgba(26,17,52,0.55)' : 'rgba(40,24,80,0.55)'
    ctx.beginPath(); ctx.roundRect(tx, ry, tw, rowH - 8, 14); ctx.fill()
    ctx.textBaseline = 'middle'; ctx.textAlign = 'left'
    ctx.fillStyle = '#b3a6d9'; ctx.font = '700 34px Inter, system-ui, sans-serif'; ctx.fillText(`${r.place}.`, tx + 22, ry + (rowH - 8) / 2)
    ctx.fillStyle = '#ffffff'; fitText(ctx, r.team, '700 34px Inter, system-ui, sans-serif', tw - 260); ctx.fillText(r.team, tx + 100, ry + (rowH - 8) / 2)
    ctx.textAlign = 'right'; ctx.fillStyle = '#ffd23f'; ctx.font = '800 34px Inter, system-ui, sans-serif'; ctx.fillText(pts(r.total), tx + tw - 22, ry + (rowH - 8) / 2)
  })
  neon(ctx, d.footer, W / 2, 1300, '700 36px Inter, system-ui, sans-serif', '#ffffff', '#b06bff', 940)
  return canvas
}
