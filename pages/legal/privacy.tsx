import Link from 'next/link';
import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';

export default function Privacy() {
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
        <Card className="auth-card">
          <h1 className="h1 accent" style={{ marginBottom: 12 }}>Privacy Policy</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            This is a placeholder Privacy Policy. Replace with your final legal text.
          </p>
          <div style={{ display: 'grid', gap: 10, fontSize: 14, lineHeight: 1.6 }}>
            <p><strong>1. Data Collected.</strong> Account details, usage logs, and media you upload.</p>
            <p><strong>2. Use of Data.</strong> To operate TurnQA, improve features, and provide support.</p>
            <p><strong>3. Sharing.</strong> Vendors we use (e.g., hosting, SMS, payments) under agreements.</p>
            <p><strong>4. Security.</strong> Industry-standard measures; no method is 100% secure.</p>
            <p><strong>5. Your Choices.</strong> You can request deletion of your account and content.</p>
          </div>

          <p className="hint" style={{ marginTop: 18 }}>
            Questions? <Link href="/support" style={{ textDecoration: 'underline' }}>Contact support</Link>
          </p>
        </Card>
      </main>
    </>
  );
}
