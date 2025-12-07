import Head from "next/head";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Card from "@/components/ui/Card";

export default function SmsTerms() {
  return (
    <>
      <Head>
        <title>TurnQA SMS Terms &amp; Consent</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta
          name="description"
          content="TurnQA SMS terms, opt-in, opt-out, and consent details for transactional notifications."
        />
      </Head>

      <Header />

      <main
        className="auth-wrap"
        style={{
          paddingTop: "80px", // prevent header overlap
          minHeight: "calc(100vh - 56px)",
          background:
            "var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100%, rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)",
          paddingBottom: "32px",
        }}
      >
        <Card className="auth-card" style={{ maxWidth: 900 }}>
          {/* Back to home */}
          <Link
            href="/"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 6,
              color: "#60a5fa",
              fontSize: 14,
              textDecoration: "none",
              marginBottom: 12,
            }}
          >
            ← Back to Home
          </Link>

          <h1 className="h1 accent">TurnQA SMS Terms &amp; Consent</h1>
          <p className="muted">
            Effective date: {new Date().toISOString().slice(0, 10)}
          </p>

          <div
            style={{
              display: "grid",
              gap: 16,
              fontSize: 15,
              lineHeight: 1.6,
            }}
          >
            <p>
              <strong>Program Name:</strong> TurnQA Alerts
            </p>
            <p>
              We send <em>transactional</em> SMS related to cleaning job
              activity (such as job invitations, turn submission alerts, and
              approvals). We do <strong>not</strong> send marketing or
              promotional SMS through this program.
            </p>

            <h2 className="h2">Opt-In &amp; Consent</h2>
            <p>
              Managers invite cleaners and other users into TurnQA. During
              onboarding, users consent to receive SMS alerts by agreeing to a
              checkbox such as:
            </p>

            <div
              style={{
                background: "rgba(255,255,255,0.06)",
                padding: 12,
                borderRadius: 8,
                fontSize: 14,
              }}
            >
              I agree to receive transactional SMS from TurnQA at the number
              provided. Message &amp; data rates may apply. Reply STOP to opt
              out, HELP for help. Consent is not a condition of purchase.
            </div>

            <h2 className="h2">Opt-Out</h2>
            <p>
              Reply <strong>STOP</strong> at any time to unsubscribe from SMS.
            </p>

            <h2 className="h2">Help</h2>
            <p>
              Reply <strong>HELP</strong> for assistance or email{" "}
              <a href="mailto:support@turnqa.com">support@turnqa.com</a>.
            </p>

            <h2 className="h2">Message Frequency</h2>
            <p>
              Typically 1–2 messages per job (submission and approval), but this
              may vary with account activity.
            </p>

            <h2 className="h2">Fees</h2>
            <p>
              Message and data rates may apply. Check your mobile plan for
              details.
            </p>

            <h2 className="h2">Carrier Disclosure</h2>
            <p>
              Carriers are not liable for delayed or undelivered messages.
            </p>

            <h2 className="h2">Privacy</h2>
            <p>
              We respect your privacy. See our{" "}
              <Link href="/legal/privacy" style={{ textDecoration: "underline" }}>
                Privacy Policy
              </Link>{" "}
              for details on how we handle information.
            </p>
          </div>
        </Card>
      </main>
    </>
  );
}
