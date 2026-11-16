import { useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';

const buttonStyle = {
  background: '#111827',
  color: '#e5e7eb',
  border: '1px solid #374151',
  borderRadius: 9,
  padding: '9px 13px',
  cursor: 'pointer',
  fontSize: 14,
};

export default function CleanerMenu() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [error, setError] = useState('');

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setError('');
    try {
      const response = await fetch('/api/cleaner/logout', {
        method: 'POST',
        credentials: 'same-origin',
      });
      if (!response.ok) throw new Error('Could not sign out. Please try again.');
      window.location.assign('/capture');
    } catch (err) {
      setError(err?.message || 'Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  const links = [
    { label: 'Cleaner Home', href: '/capture' },
    { label: 'My Turns', href: '/cleaner/turns' },
    { label: 'Needs Fix', href: '/capture?tab=needs-fix' },
  ];

  return (
    <div style={{ position: 'relative', display: 'inline-block', zIndex: 50 }}>
      <button
        type="button"
        style={buttonStyle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls="turnqa-cleaner-menu"
        onClick={() => setOpen((value) => !value)}
      >
        ☰ Menu
      </button>
      {open && (
        <div
          id="turnqa-cleaner-menu"
          role="menu"
          style={{
            position: 'absolute',
            right: 0,
            top: 'calc(100% + 8px)',
            minWidth: 205,
            background: '#111827',
            border: '1px solid #374151',
            borderRadius: 12,
            boxShadow: '0 12px 28px rgba(0,0,0,.4)',
            padding: 7,
          }}
        >
          {links.map(({ label, href }) => (
            <Link
              key={href}
              href={href}
              role="menuitem"
              aria-current={router.asPath === href ? 'page' : undefined}
              onClick={() => setOpen(false)}
              style={{ display: 'block', padding: '11px 12px', color: '#e5e7eb', textDecoration: 'none', borderRadius: 7 }}
            >
              {label}
            </Link>
          ))}
          <div style={{ borderTop: '1px solid #374151', margin: '6px 0' }} />
          <button
            type="button"
            role="menuitem"
            onClick={signOut}
            disabled={signingOut}
            style={{ ...buttonStyle, width: '100%', textAlign: 'left', border: 'none', background: 'transparent' }}
          >
            {signingOut ? 'Signing out…' : 'Sign Out'}
          </button>
          {error && <p role="alert" style={{ color: '#fca5a5', fontSize: 12, padding: '0 12px' }}>{error}</p>}
        </div>
      )}
    </div>
  );
}
