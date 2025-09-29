import Header from '@/components/layout/Header';
import Card from '@/components/ui/Card';
import Link from 'next/link';

export default function Support() {
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
          <h1 className="h1 accent" style={{ marginBottom: 12 }}>Support</h1>
          <p className="muted" style={{ marginBottom: 16 }}>
            Need a hand? We’re here to help.
          </p>

          <div style={{ display: 'grid', gap: 10, fontSize: 14, lineHeight: 1.6 }}>
            <p>
              📧 Email us:{" "}
              <a href="mailto:support@turnqa.com" style={{ textDecoration: 'underline' }}>
                support@turnqa.com
              </a>
            </p>
            <p>
              🧾 Terms & Privacy:{" "}
              <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>Terms</Link>{" "}
              •{" "}
              <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>Privacy</Link>
            </p>
          </div>

          <p className="hint" style={{ marginTop: 18 }}>
            Tip: include your account email and a short description of the issue for the fastest response.
          </p>
        </Card>
      </main>
    </>
  );
}
