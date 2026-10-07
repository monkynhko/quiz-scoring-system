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

export async function drawSocialImage(canvas: HTMLCanvasElement, d: SocialImageData, base = '') {
  const W = 1080, H = 1350
  canvas.width = W; canvas.height = H
  const ctx = canvas.getContext('2d')!
  // Inter musí byť načítaný skôr, než kreslíme (inak canvas použije náhradné písmo)
  await Promise.all(['800 64px Inter', '700 56px Inter'].map((f) => document.fonts?.load(f).catch(() => null)))
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
