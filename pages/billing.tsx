import Card from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { useState } from 'react';

export default function Billing() {
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function startCheckout() {
    setLoading(true);
    setErr(null);
    try {
      const res = await fetch('/api/billing/checkout', { method: 'POST' });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Request failed (${res.status})`);
      }
      const { url } = await res.json();
      if (!url) throw new Error('No checkout URL returned.');
      window.location.href = url;
    } catch (e: any) {
      setErr(e.message || 'Something went wrong.');
      setLoading(false);
    }
  }

  return (
    <main className="auth-wrap" style={{ minHeight: '100vh' }}>
      <Card className="auth-card" >
        <h1 className="h1 accent" style={{ marginBottom: 12 }}>Your plan</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          Your trial may have ended. Start a subscription to keep using TurnQA. Cancel anytime.
        </p>
        <PrimaryButton onClick={startCheckout} disabled={loading}>
          {loading ? 'Redirecting…' : 'Start subscription'}
        </PrimaryButton>
        {err && <p style={{ marginTop: 10, color: '#fca5a5', fontSize: 14 }}>{err}</p>}
      </Card>
    </main>
  );
}
