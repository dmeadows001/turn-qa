import Link from 'next/link';
import Image from 'next/image';

export default function Header() {
  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        borderBottom: '1px solid var(--border)',
        background: 'rgba(11,11,13,0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="container"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 12,
          paddingTop: 14,
          paddingBottom: 14,
        }}
      >
        {/* Logo (from /public/logo-camera.svg) */}
        <Link href="/" aria-label="TurnQA home" style={{ display: 'inline-flex', alignItems: 'center', gap: 10 }}>
          <Image
            src="/logo-camera.svg"
            alt="TurnQA"
            width={28}
            height={28}
            priority
          />
          <span style={{ fontWeight: 700, letterSpacing: 0.2 }}>TurnQA</span>
        </Link>

        <div style={{ marginLeft: 'auto', opacity: 0.7, fontSize: 14 }}>Midnight</div>
      </div>
    </header>
  );
}
