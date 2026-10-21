
import Card from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import Header from '@/components/layout/Header';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

type BillingStatus = {
  ok: boolean;
  allowed: boolean;
  subscription_status: string | null;
  active_until: string | null;
  trial_ends_at: string | null;
  plan_name?: string | null;
  price_amount?: number | null;
  currency?: string | null;
  billing_interval?: string | null;
  cancel_at_period_end?: boolean;
  cancel_at?: string | null;
  current_period_end?: string | null;
  next_billing_date?: string | null;
};

function formatDate(value?: string | null) {
  if (!value) return null;

  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;

  return date.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
    timeZone: 'UTC',
  });
}

function formatPrice(
  amount?: number | null,
  currency?: string | null
) {
  if (amount == null || !currency) return null;

  try {
    return new Intl.NumberFormat('en-US', {
      style: 'currency',
      currency,
    }).format(amount);
  } catch {
    return `${amount.toFixed(2)} ${currency}`;
  }
}

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div style={{ minWidth: 0 }}>
      <div
        className="muted"
        style={{ fontSize: 12, marginBottom: 6 }}
      >
        {label}
      </div>
      <div
        style={{
          fontSize: 14,
          fontWeight: 600,
          overflowWrap: 'anywhere',
        }}
      >
        {value}
      </div>
    </div>
  );
}

export default function Billing() {
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [err, setErr] = useState<string | null>(null);
  const [notSignedIn, setNotSignedIn] = useState(false);
  const [billing, setBilling] = useState<BillingStatus | null>(null);

  async function getAccessToken(): Promise<string | null> {
    const supabase = supabaseBrowser();
    const { data, error } = await supabase.auth.getSession();

    if (error) throw error;

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
          throw new Error(
            body?.error || 'Please sign in to continue.'
          );
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
          throw new Error(
            body?.error || 'Please sign in to start checkout.'
          );
        }

        throw new Error(
          body?.error || `Request failed (${res.status})`
        );
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
          throw new Error(
            body?.error || 'Please sign in to manage billing.'
          );
        }

        throw new Error(
          body?.error ||
            `Unable to open billing portal (${res.status})`
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

  const status = String(
    billing?.subscription_status || ''
  ).toLowerCase();

  const isPastDue = [
    'past_due',
    'unpaid',
    'incomplete',
    'paused',
  ].includes(status);

  const isActive = status === 'active';
  const isTrial = status === 'trial' || status === 'trialing';
  const hasExpiredTrial = isTrial && !billing?.allowed;

  const isCanceled = [
    'canceled',
    'cancelled',
    'incomplete_expired',
  ].includes(status);

  const isCancelScheduled =
    (isActive || isTrial) &&
    !!billing?.allowed &&
    (!!billing?.cancel_at_period_end || !!billing?.cancel_at);

  const cancellationDate = formatDate(
    billing?.cancel_at || billing?.current_period_end
  );

  const renewalDate = formatDate(billing?.next_billing_date);
  const trialEndDate = formatDate(billing?.trial_ends_at);

  const price = formatPrice(
    billing?.price_amount,
    billing?.currency
  );

  const interval = billing?.billing_interval;
  const priceLabel = price
    ? `${price}${interval ? ` / ${interval}` : ''}`
    : null;

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
  } else if (isCancelScheduled) {
    title = 'Cancellation scheduled';
    description = cancellationDate
      ? `Your subscription remains active until ${cancellationDate}. You can continue using TurnQA until then. Your saved turnover information will remain preserved.`
      : 'Your subscription is scheduled to end. You can continue using TurnQA while your subscription remains active.';
    buttonText = 'Manage subscription';
    action = openPortal;
  } else if (isActive) {
    title = 'Your subscription is active';
    description =
      'Your TurnQA subscription is active. Review your plan below or manage payment methods, invoices, and subscription settings securely through Stripe.';
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

  const showPlanDetails =
    !!billing?.plan_name ||
    !!priceLabel ||
    isActive ||
    isTrial ||
    isCanceled ||
    isPastDue;

  let displayStatus = 'No active subscription';

  if (isPastDue) {
    displayStatus = 'Payment attention required';
  } else if (isCancelScheduled) {
    displayStatus = 'Active — cancellation scheduled';
  } else if (isActive) {
    displayStatus = 'Active — renewing';
  } else if (isTrial && !hasExpiredTrial) {
    displayStatus = 'Trial active';
  } else if (isCanceled) {
    displayStatus = 'Ended';
  } else if (hasExpiredTrial) {
    displayStatus = 'Trial expired';
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
        <div style={{ width: '100%', maxWidth: 560 }}>
          <Card className="auth-card">
            {checking ? (
              <>
                <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                  Your plan
                </h1>
                <p className="muted">
                  Checking your subscription...
                </p>
              </>
            ) : notSignedIn ? (
              <>
                <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                  Sign in required
                </h1>
                <p className="muted" style={{ marginBottom: 16 }}>
                  Please sign in to view or manage your
                  TurnQA subscription.
                </p>
                <Link
                  href="/login"
                  style={{ textDecoration: 'underline' }}
                >
                  Sign in
                </Link>
              </>
            ) : hasBillingError ? (
              <>
                <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                  Unable to load billing
                </h1>
                <p className="muted">
                  We couldn't check your subscription right now.
                  Please refresh this page and try again.
                </p>
                <p
                  style={{
                    marginTop: 12,
                    color: '#fca5a5',
                    fontSize: 14,
                  }}
                >
                  {err}
                </p>
              </>
            ) : (
              <>
                <h1 className="h1 accent" style={{ marginBottom: 12 }}>
                  {title}
                </h1>

                <p
                  className="muted"
                  style={{ marginBottom: 18, lineHeight: 1.6 }}
                >
                  {description}
                </p>

                {showPlanDetails && (
                  <section
                    style={{
                      padding: 18,
                      marginBottom: 20,
                      border: '1px solid rgba(255,255,255,.12)',
                      borderRadius: 14,
                      background: 'rgba(255,255,255,.025)',
                    }}
                  >
                    <div
                      className="muted"
                      style={{
                        fontSize: 12,
                        marginBottom: 6,
                      }}
                    >
                      CURRENT PLAN
                    </div>

                    <div
                      style={{
                        fontSize: 21,
                        fontWeight: 700,
                        marginBottom: 6,
                      }}
                    >
                      {billing?.plan_name || 'TurnQA Pro'}
                    </div>

                    {priceLabel && (
                      <div
                        style={{
                          fontSize: 18,
                          fontWeight: 600,
                          marginBottom: 18,
                        }}
                      >
                        {priceLabel}
                      </div>
                    )}

                    <div
                      style={{
                        display: 'grid',
                        gridTemplateColumns:
                          'repeat(auto-fit, minmax(170px, 1fr))',
                        gap: 18,
                        borderTop: '1px solid rgba(255,255,255,.1)',
                        paddingTop: 16,
                      }}
                    >
                      <Detail
                        label="Subscription status"
                        value={displayStatus}
                      />

                      {isCancelScheduled && (
                        <>
                          <Detail
                            label="Access until"
                            value={
                              cancellationDate || 'Date unavailable'
                            }
                          />
                          <Detail
                            label="Next renewal"
                            value="None — cancellation scheduled"
                          />
                        </>
                      )}

                      {isActive && !isCancelScheduled && (
                        <Detail
                          label="Next renewal"
                          value={
                            renewalDate || 'Date unavailable'
                          }
                        />
                      )}

                      {isTrial && !isCancelScheduled && (
                        <Detail
                          label="Trial ends"
                          value={
                            trialEndDate || 'Date unavailable'
                          }
                        />
                      )}

                      {isCanceled && (
                        <Detail
                          label="TurnQA access"
                          value={
                            billing?.allowed
                              ? 'Available'
                              : 'Subscription required'
                          }
                        />
                      )}

                      {isPastDue && (
                        <Detail
                          label="Action needed"
                          value="Update payment method"
                        />
                      )}
                    </div>
                  </section>
                )}

                <PrimaryButton
                  onClick={action}
                  disabled={loading}
                >
                  {loading ? 'Redirecting...' : buttonText}
                </PrimaryButton>

                {(isActive ||
                  (isTrial && billing?.allowed)) && (
                  <p
                    className="hint"
                    style={{
                      marginTop: 14,
                      fontSize: 14,
                    }}
                  >
                    <Link
                      href="/managers/turns"
                      style={{ textDecoration: 'underline' }}
                    >
                      Return to turnovers
                    </Link>
                  </p>
                )}

                {notSignedIn && (
                  <p
                    className="hint"
                    style={{
                      marginTop: 12,
                      fontSize: 14,
                    }}
                  >
                    You're not signed in.{' '}
                    <Link
                      href="/login"
                      style={{ textDecoration: 'underline' }}
                    >
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
        </div>
      </main>
    </>
  );
}
