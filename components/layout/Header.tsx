
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

    async function load() {
      const {
        data: { session },
      } = await supabase.auth.getSession();

      if (!session?.user) {
        setDisplayName(null);
        return;
      }

      const { data: profile } = await supabase
        .from('profiles')
        .select('full_name, phone, email')
        .eq('id', session.user.id)
        .maybeSingle();

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
        load();
      }, 0);
    });

    return () => listener.subscription.unsubscribe();
  }, []);

  async function signOut() {
    const supabase = supabaseBrowser();
    await supabase.auth.signOut();
    window.location.href = '/';
  }

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
          justifyContent: 'space-between',
          flexWrap: 'wrap',
          gap: 12,
          paddingTop: 14,
          paddingBottom: 14,
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
            flexShrink: 0,
            textDecoration: 'none',
          }}
        >
          <Image
            src="/logo-camera.svg"
            alt="TurnQA"
            width={36}
            height={36}
            priority
          />
          <span style={{ fontWeight: 700, letterSpacing: 0.2 }}>
            TurnQA
          </span>
        </Link>

        {displayName ? (
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'flex-end',
              flexWrap: 'wrap',
              gap: 10,
              minWidth: 0,
              width: '100%',
            }}
          >
            <span
              className="muted"
                style={{
                  fontSize: 13,
                  padding: '6px 10px',
                  border: '1px solid var(--border)',
                  borderRadius: 12,
                  background: 'rgba(255,255,255,.04)',
                  maxWidth: '100%',
                  boxSizing: 'border-box',
                  overflowWrap: 'anywhere',
                  textAlign: 'right',
                  flexShrink: 0,
                }}
              title={displayName}
            >
              {displayName}
            </span>

            <button
              onClick={signOut}
              className="btn"
              style={{
                padding: '6px 10px',
                borderRadius: 12,
                flexShrink: 0,
              }}
              aria-label="Sign out"
            >
              Sign out
            </button>
          </div>
        ) : (
          <Link
            href="/login"
            className="btn"
            style={{
              padding: '6px 10px',
              borderRadius: 12,
            }}
          >
            Sign in
          </Link>
        )}
      </div>
    </header>
  );
}
