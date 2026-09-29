import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import QRCode from 'qrcode'

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <div className="page">
      <header className="site-header">
        <Link to="/" className="logo" aria-label="Kvíz Factory – domov">
          <img src="/logo.webp" alt="Kvíz Factory" width={460} height={307} />
        </Link>
      </header>
      <main>{children}</main>
      <footer className="site-footer">
        <p>
          Otázky, zmeny a odhlásenie tímu cez naše sociálne siete{' '}
          <a href="https://www.facebook.com/profile.php?id=100069066071338" target="_blank" rel="noreferrer">Facebook</a> a{' '}
          <a href="https://www.instagram.com/kviz.factory/" target="_blank" rel="noreferrer">Instagram</a>.
        </p>
        <p>
          <Link to="/podmienky">Podmienky účasti</Link> · <Link to="/ochrana-udajov">Ochrana osobných údajov</Link> · SP Factory s.r.o.
        </p>
      </footer>
    </div>
  )
}

export function QR({ value, size = 220, label }: { value: string; size?: number; label?: string }) {
  const [src, setSrc] = useState<string>()
  useEffect(() => {
    QRCode.toDataURL(value, { width: size * 2, margin: 1, errorCorrectionLevel: 'M' }).then(setSrc)
  }, [value, size])
  return src ? <img src={src} width={size} height={size} alt={label ?? 'QR kód'} className="qr" /> : <div className="qr qr-placeholder" style={{ width: size, height: size }} />
}

export function Spinner({ text = 'Načítavam…' }: { text?: string }) {
  return <p className="muted center" role="status">{text}</p>
}
