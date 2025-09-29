import Card from '@/components/ui/Card';
import { PrimaryButton } from '@/components/ui/Button';
import { useState } from 'react';

export default function Billing() {
  const [loading, setLoading] = useState(false);
  async function startCheckout() {
    setLoading(true);
    const res = await fetch('/api/billing/checkout', { method: 'POST' });
    const { url } = await res.json();
    window.location.href = url;
  }
  return (
    <main className="centered">
      <Card className="w-full max-w-lg">
        <h1 className="h1">Your plan</h1>
        <p className="muted" style={{ marginBottom: 16 }}>
          Your trial may have ended. Start a subscription to keep using TurnQA. Cancel anytime.
        </p>
        <PrimaryButton onClick={startCheckout} disabled={loading}>
          {loading ? 'Redirecting…' : 'Start subscription'}
        </PrimaryButton>
      </Card>
    </main>
  );
}
