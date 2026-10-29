
import Link from 'next/link';
import Image from 'next/image';
import { useEffect, useState } from 'react';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

type Profile = {
  full_name?: string | null;
  phone?: string | null;
  email?: string | null;
};

export default function Header() {
  const [displayName, setDisplayName] = useState<string | null>(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    let mounted = true;

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!mounted) return;

      if (!session?.user) {
        setDisplayName(null);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, email')
        .eq('id', session.user.id)
        .maybeSingle();

      if (!mounted) return;

      const name =
        profile?.full_name ||
        profile?.phone ||
        (session.user.user_metadata?.phone as string | undefined) ||
        session.user.email ||
        'Account';

      setDisplayName(name);
    }

    load();

    const { data: listener } = supabase.auth.onAuthStateChange(() => {
      setTimeout(() => {
        if (mounted) load();
      }, 0);
    });

    return () => {
      mounted = false;
      listener.subscription.unsubscribe();
    };
  }, []);

  async function signOut() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  const actionStyle = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    flex: '0 0 auto',
    width: 'auto',
    padding: '8px 14px',
    borderRadius: 10,
    border: '1px solid #334155',
    background: '#111827',
    color: '#e2e8f0',
    fontSize: 13,
    fontWeight: 600,
    lineHeight: '20px',
    textDecoration: 'none',
    whiteSpace: 'nowrap' as const,
    cursor: 'pointer',
    boxSizing: 'border-box' as const,
  };

  return (
    <header
      style={{
        position: 'sticky',
        top: 0,
        zIndex: 20,
        width: '100%',
        borderBottom: '1px solid var(--border)',
        background: 'rgba(11,11,13,0.6)',
        backdropFilter: 'blur(8px)',
      }}
    >
      <div
        className="container"
        style={{
          width: '100%',
          boxSizing: 'border-box',
          paddingTop: 14,
          paddingBottom: 14,
        }}
      >
        {/* First row: logo and authentication action */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexWrap: 'nowrap',
            gap: 12,
            width: '100%',
            minWidth: 0,
          }}
        >
          <Link
            href="/"
            aria-label="TurnQA home"
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 12,
              minWidth: 0,
              flex: '0 1 auto',
              textDecoration: 'none',
              color: 'inherit',
            }}
          >
            <Image
              src="/logo-camera.svg"
              alt="TurnQA"
              width={36}
              height={36}
              priority
              style={{ flexShrink: 0 }}
            />
            <span
              style={{
                fontWeight: 700,
                letterSpacing: 0.2,
                whiteSpace: 'nowrap',
              }}
            >
              TurnQA
            </span>
          </Link>

          {displayName ? (
            <button
              type="button"
              onClick={signOut}
              style={actionStyle}
              aria-label="Sign out"
            >
              Sign out
            </button>
          ) : (
            <Link
              href="/login"
              style={actionStyle}
            >
              Sign in
            </Link>
          )}
        </div>

        {/* Second row: account identity, only when signed in */}
        {displayName && (
          <div
            style={{
              display: 'flex',
              justifyContent: 'center',
              marginTop: 12,
              minWidth: 0,
            }}
          >
            <span
              className="muted"
              style={{
                fontSize: 13,
                padding: '6px 12px',
                border: '1px solid var(--border)',
                borderRadius: 999,
                background: 'rgba(255,255,255,.04)',
                maxWidth: '100%',
                boxSizing: 'border-box',
                overflowWrap: 'anywhere',
                textAlign: 'center',
              }}
              title="Signed in account"
            >
              {displayName}
            </span>
          </div>
        )}
      </div>
    </header>
  );
}
