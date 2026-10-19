
import Card from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { createClient } from '@supabase/supabase-js';

type BillingStatus = {
  ok: boolean;
  allowed: boolean;
  subscription_status: string | null;
  active_until: string | null;
  trial_ends_at: string | null;
};

export default function Billing() {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  async function getAccessToken(): Promise<string | null> {
    const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
    const key = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

    if (!url || !key) return null;

    const supabase = createClient(url, key);
    const { data } = await supabase.auth.getSession();

    return data.session?.access_token || null;
  }

  async function authHeaders(): Promise<Record<string, string>> {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  useEffect(() => {
    let cancelled = false;

    async function loadBillingStatus() {
      try {
        const headers = await authHeaders();

        const res = await fetch('/api/billing/status', {
          method: 'GET',
          credentials: 'include',
          headers,
          cache: 'no-store',
        });

        const body = await res.json().catch(() => ({}));

        if (cancelled) return;

        if (res.status === 401) {
          setNotSignedIn(true);
          return;
        }

        if (!res.ok) {
          throw new Error(
            body?.error || `Unable to load billing status (${res.status})`
          );
        }

        setBilling(body as BillingStatus);
      } catch (e: any) {
        if (!cancelled) {
          setErr(e.message || 'Unable to load billing status.');
        }
      } finally {
        if (!cancelled) setChecking(false);
      }
    }

    loadBillingStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  async function startCheckout() {
    setLoading(true);
    setErr(null);
    setNotSignedIn(false);

    try {
      const headers = await authHeaders();

      const ensure = await fetch('/api/ensure-profile', {
        method: 'POST',
        credentials: 'include',
        headers,
      });

      if (!ensure.ok) {
        const body = await ensure.json().catch(() => ({}));

        if (ensure.status === 401) {
          setNotSignedIn(true);
          throw new Error(body?.error || 'Please sign in to continue.');
        }

        throw new Error(
          body?.error || `ensure-profile failed (${ensure.status})`
        );
      }

      const res = await fetch('/api/billing/checkout', {
        method: 'POST',
        credentials: 'include',
        headers,
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          setNotSignedIn(true);
          throw new Error(body?.error || 'Please sign in to start checkout.');
        }

        throw new Error(body?.error || `Request failed (${res.status})`);
      }

      if (!body?.url) {
        throw new Error('No checkout URL returned.');
      }

      window.location.assign(body.url);
    } catch (e: any) {
      setErr(e.message || 'Something went wrong.');
      setLoading(false);
    }
  }

  async function openPortal() {
    setLoading(true);
    setErr(null);
    setNotSignedIn(false);

    try {
      const headers = await authHeaders();

      const res = await fetch('/api/billing/portal', {
        method: 'POST',
        credentials: 'include',
        headers,
      });

      const body = await res.json().catch(() => ({}));

      if (!res.ok) {
        if (res.status === 401) {
          setNotSignedIn(true);
          throw new Error(body?.error || 'Please sign in to manage billing.');
        }

        throw new Error(
          body?.error || `Unable to open billing portal (${res.status})`
        );
      }

      if (!body?.url) {
        throw new Error('No billing portal URL returned.');
      }

      window.location.assign(body.url);
    } catch (e: any) {
      setErr(e.message || 'Unable to open billing management.');
      setLoading(false);
    }
  }

  const status = String(billing?.subscription_status || '').toLowerCase();

  const isPastDue = [
    'past_due',
    'unpaid',
    'incomplete',
    'paused',
  ].includes(status);

  const isActive = status === 'active';

  const isTrial = status === 'trial' || status === 'trialing';

  const hasExpiredTrial = isTrial && !billing?.allowed;

  const isCanceled =
    status === 'canceled' ||
    status === 'cancelled' ||
    status === 'incomplete_expired';

  const hasBillingError = !checking && !!err && !billing;

  let title = 'Your plan';
  let description =
    'Start a subscription to keep using TurnQA. Cancel anytime.';
  let buttonText = 'Start subscription';
  let action = startCheckout;

  if (isPastDue) {
    title = 'Payment unsuccessful';
    description =
      "We couldn't process your latest TurnQA subscription payment. Update your payment method to restore access. Your properties, photos, and turnover history remain saved.";
    buttonText = 'Update payment method';
    action = openPortal;
  } else if (isActive) {
    title = 'Your subscription is active';
    description =
      'Your TurnQA subscription is active. You can manage payment methods, invoices, and subscription settings securely through Stripe.';
    buttonText = 'Manage billing';
    action = openPortal;
  } else if (isTrial && !hasExpiredTrial) {
    title = 'Your trial is active';
    description =
      'Your TurnQA trial is still active. You can start your subscription whenever you are ready.';
  } else if (isCanceled) {
    title = 'Your subscription has ended';
    description =
      'Your previous TurnQA subscription has ended. Your existing turnover information remains saved. Manage your billing account or contact support before starting another subscription.';
    buttonText = 'Manage billing';
    action = openPortal;
  } else if (hasExpiredTrial) {
    title = 'Your trial has ended';
    description =
      'Your TurnQA trial has ended. Start a subscription to continue managing your turnovers.';
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
          {checking ? (
            <>
              <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                Your plan
              </h1>
              <p className="muted">Checking your subscription...</p>
            </>
          ) : notSignedIn ? (
            <>
              <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                Sign in required
              </h1>
              <p className="muted" style={{ marginBottom: 16 }}>
                Please sign in to view or manage your TurnQA subscription.
              </p>
              <Link href="/login" style={{ textDecoration: 'underline' }}>
                Sign in
              </Link>
            </>
          ) : hasBillingError ? (
            <>
              <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                Unable to load billing
              </h1>
              <p className="muted">
                We couldn't check your subscription right now. Please
                refresh this page and try again.
              </p>
              <p style={{ marginTop: 12, color: '#fca5a5', fontSize: 14 }}>
                {err}
              </p>
            </>
          ) : (
            <>
              <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                {title}
              </h1>

              <p className="muted" style={{ marginBottom: 16 }}>
                {description}
              </p>

              <PrimaryButton onClick={action} disabled={loading}>
                {loading ? 'Redirecting...' : buttonText}
              </PrimaryButton>

              {isActive && (
                <p className="hint" style={{ marginTop: 14, fontSize: 14 }}>
                  <Link
                    href="/managers/turns"
                    style={{ textDecoration: 'underline' }}
                  >
                    Return to turnovers
                  </Link>
                </p>
              )}

              {notSignedIn && (
                <p className="hint" style={{ marginTop: 12, fontSize: 14 }}>
                  You're not signed in.{' '}
                  <Link href="/login" style={{ textDecoration: 'underline' }}>
                    Sign in
                  </Link>{' '}
                  and try again.
                </p>
              )}

              {err && (
                <p
                  style={{
                    marginTop: 12,
                    color: '#fca5a5',
                    fontSize: 14,
                  }}
                >
                  {err}
                </p>
              )}
            </>
          )}
        </Card>
      </main>
    </>
  );
}
