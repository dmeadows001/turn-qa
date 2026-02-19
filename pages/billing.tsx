// pages/billing.tsx
import Card from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';

export default function Billing() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);

  async function startCheckout() {
    setLoading(true);
    setErr(null);
    setNotSignedIn(false);

    try {
      // Step 1: ensure profile exists (cookie-based)
      const ensure = await fetch('/api/ensure-profile', {
        method: 'POST',
        credentials: 'include',
      });

      if (!ensure.ok) {
        const body = await ensure.json().catch(() => ({}));
        if (ensure.status === 401) {
          setNotSignedIn(true);
          throw new Error(body?.error || 'Please sign in to continue.');
        }
        throw new Error(body?.error || `ensure-profile failed (${ensure.status})`);
      }

      // Step 2: create checkout session (cookie-based)
      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          setNotSignedIn(true);
          throw new Error(body?.error || 'Please sign in to start checkout.');
        }
        throw new Error(body?.error || `Request failed (${res.status})`);
      }

      const url = body?.url as string | undefined;
      if (!url) throw new Error('No checkout URL returned.');

      // Hard navigation
      window.location.assign(url);
      return;
    } catch (e: any) {
      setErr(e.message || 'Something went wrong.');
      setLoading(false);
    }
  }

  return (
    <>
      <Header />
      <main
        className="auth-wrap"
        style={{
          minHeight: 'calc(100vh - 56px)',
          background:
            'var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)',
        }}
      >
        <Card className="auth-card">
          <h1 className="h1 accent" style={{ marginBottom: 12 }}>Your plan</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            Your trial may have ended. Start a subscription to keep using TurnQA. Cancel anytime.
          </p>

          <PrimaryButton onClick={startCheckout} disabled={loading}>
            {loading ? 'Redirecting…' : 'Start subscription'}
          </PrimaryButton>

          {notSignedIn && (
            <p className="hint" style={{ marginTop: 12, fontSize: 14 }}>
              You’re not signed in.{' '}
              <Link href="/login" style={{ textDecoration: 'underline' }}>
                Sign in
              </Link>{' '}
              and try again.
            </p>
          )}

          {err && !notSignedIn && (
            <p style={{ marginTop: 12, color: '#fca5a5', fontSize: 14 }}>
              {err}
            </p>
          )}
        </Card>
      </main>
    </>
  );
}
