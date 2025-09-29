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
    <div className="p-8 text-gray-100">
      <h1 className="text-2xl mb-3">Your plan</h1>
      <p className="mb-6 opacity-80">Your trial may have ended. Start a subscription to keep using TurnQA. Cancel anytime.</p>
      <button onClick={startCheckout} disabled={loading} className="bg-white/10 hover:bg-white/20 px-4 py-2 rounded-2xl">
        {loading ? 'Redirecting…' : 'Start subscription'}
      </button>
    </div>
  );
}
