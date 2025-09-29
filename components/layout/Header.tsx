import Link from 'next/link';

export default function Header() {
  return (
    <header style={{
      position: 'sticky',
      top: 0,
      zIndex: 20,
      borderBottom: '1px solid var(--border)',
      background: 'rgba(11,11,13,0.6)',
      backdropFilter: 'blur(8px)'
    }}>
      <div className="container" style={{ display: 'flex', alignItems: 'center', gap: 12, paddingTop: 14, paddingBottom: 14 }}>
        {/* Inline logo = no broken path */}
        <svg width="28" height="28" viewBox="0 0 32 32" aria-hidden focusable="false">
          <defs>
            <linearGradient id="g" x1="0" y1="0" x2="32" y2="32" gradientUnits="userSpaceOnUse">
              <stop stopColor="#7C5CFF"/><stop offset="1" stopColor="#00E5FF"/>
            </linearGradient>
          </defs>
          <rect x="2" y="2" width="28" height="28" rx="8" fill="url(#g)"/>
          <path d="M16 8c-4.418 0-8 3.134-8 7s3.582 7 8 7c1.78 0 3.43-.5 4.77-1.36l1.7 1.7a1 1 0 0 0 1.41-1.41l-1.66-1.66A6.97 6.97 0 0 0 23 15c0-3.866-3.582-7-7-7Zm0 2c3.314 0 6 2.243 6 5s-2.686 5-6 5-6-2.243-6-5 2.686-5 6-5Z" fill="#0b0b0d"/>
        </svg>

        <Link href="/" style={{ fontWeight: 700, letterSpacing: 0.2 }}>TurnQA</Link>
        <div style={{ marginLeft: 'auto', opacity: .7, fontSize: 14 }}>Midnight</div>
      </div>
    </header>
  );
}
