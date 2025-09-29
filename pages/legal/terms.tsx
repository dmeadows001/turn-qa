import Link from 'next/link';
import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';

export default function Terms() {
  return (
    <>
      <Header />
      <main
        className="auth-wrap"
        style={{
          minHeight: 'calc(100vh - 56px)',
          background:
            'var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)'
        }}
      >
        <Card className="auth-card" >
          <h1 className="h1 accent" style={{ marginBottom: 12 }}>Terms of Service</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            These are placeholder Terms. Replace with your final legal text.
          </p>
          <div style={{ display: 'grid', gap: 10, fontSize: 14, lineHeight: 1.6 }}>
            <p><strong>1. Acceptance.</strong> By using TurnQA you agree to these Terms.</p>
            <p><strong>2. Trial & Billing.</strong> Trials last 30 days. Subscriptions renew until canceled.</p>
            <p><strong>3. Acceptable Use.</strong> Don’t abuse or attempt to break the service.</p>
            <p><strong>4. Termination.</strong> We may suspend accounts that violate these Terms.</p>
            <p><strong>5. Liability.</strong> Service provided “as is” with no warranties.</p>
          </div>

          <p className="hint" style={{ marginTop: 18 }}>
            Need help? <Link href="/support" style={{ textDecoration: 'underline' }}>Contact support</Link>
          </p>
        </Card>
      </main>
    </>
  );
}
