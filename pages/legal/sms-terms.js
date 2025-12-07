import Header from "@/components/layout/Header";
import Card from "@/components/ui/Card";
import Head from "next/head";

export default function SmsTerms() {
  return (
    <>
      <Head>
        <title>TurnQA SMS Terms & Consent</title>
        <meta name="robots" content="noindex,nofollow" />
      </Head>

      <Header />

      <main
        className="auth-wrap"
        style={{
          minHeight: "calc(100vh - 56px)",
          background:
            "var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)",
          padding: "32px 0",
        }}
      >
        <Card className="auth-card" style={{ maxWidth: 900 }}>
          <h1 className="h1 accent">TurnQA SMS Terms & Consent</h1>
          <p className="muted">Effective date: {new Date().toISOString().slice(0, 10)}</p>

          <div style={{ display: "grid", gap: 16, fontSize: 15, lineHeight: 1.6 }}>
            <p><strong>Program Name:</strong> TurnQA Alerts</p>
            <p>
              We send <em>transactional</em> SMS related to cleaning job activity.
              No marketing messages are ever sent.
            </p>

            <h2 className="h2">Opt-In & Consent</h2>
            <p>
              Users are invited by managers and consent by selecting the checkbox during onboarding:
            </p>

            <div
              style={{
                background: "rgba(255,255,255,0.06)",
                padding: 12,
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              I agree to receive transactional SMS from TurnQA. Message & data rates may apply.
              Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.
            </div>

            <h2 className="h2">Opt-Out</h2>
            <p>Reply STOP at any time to unsubscribe.</p>

            <h2 className="h2">Help</h2>
            <p>Reply HELP or email support@turnqa.com.</p>

            <h2 className="h2">Message Frequency</h2>
            <p>Usually 1–2 messages per job based on activity.</p>

            <h2 className="h2">Carrier Disclosure</h2>
            <p>Carriers are not liable for delays or undelivered messages.</p>

            <h2 className="h2">Privacy</h2>
            <p>
              View our <a href="/legal/privacy">Privacy Policy</a> for data usage details.
            </p>
          </div>
        </Card>
      </main>
    </>
  );
}
