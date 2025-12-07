import Link from "next/link";
import Header from "@/components/layout/Header";
import Card from "@/components/ui/Card";

export default function Terms() {
  return (
    <>
      <Header />

      <main
        className="auth-wrap"
        style={{
          paddingTop: "80px", // prevent header overlap
          minHeight: "calc(100vh - 56px)",
          background:
            "var(--bg), radial-gradient(1000px 600px at 80% -10%, rgba(124,92,255,.16), transparent 60%), radial-gradient(800px 500px at 0% 100% , rgba(0,229,255,.08), transparent 60%), linear-gradient(180deg, rgba(255,255,255,0.02), rgba(255,255,255,0) 40%)",
          paddingBottom: "32px",
        }}
      >
        <Card className="auth-card">
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

          <h1 className="h1 accent" style={{ marginBottom: 12 }}>
            Terms of Service
          </h1>
          <p className="muted" style={{ marginBottom: 16, fontSize: 14 }}>
            These Terms of Service (&quot;Terms&quot;) govern your use of the
            TurnQA website and application (the &quot;Service&quot;). By
            accessing or using TurnQA, you agree to these Terms.
          </p>

          <div
            style={{
              display: "grid",
              gap: 10,
              fontSize: 14,
              lineHeight: 1.6,
            }}
          >
            <p>
              <strong>1. Accounts &amp; Eligibility.</strong> You must be able
              to form a binding contract to use TurnQA. You are responsible for
              maintaining the confidentiality of your login credentials and for
              all activity that occurs under your account.
            </p>

            <p>
              <strong>2. Use of the Service.</strong> TurnQA is intended to help
              property managers and cleaners coordinate and document cleaning
              jobs. You agree to use the Service only for lawful purposes and in
              accordance with these Terms.
            </p>

            <p>
              <strong>3. Trial &amp; Billing.</strong> If we offer a free trial,
              it will run for the period advertised (for example, 30 days).
              After the trial ends, paid subscriptions are billed in advance and
              renew automatically until canceled. You can cancel future renewals
              at any time in your account settings.
            </p>

            <p>
              <strong>4. SMS Notifications.</strong> TurnQA may send
              transactional SMS to managers and cleaners related to job activity
              (such as job invitations, submission alerts, and approvals).
              Message &amp; data rates may apply. You can opt out at any time by
              replying <strong>STOP</strong>. For more details, see our{" "}
              <Link
                href="/legal/sms-terms"
                style={{ textDecoration: "underline" }}
              >
                SMS Terms &amp; Consent
              </Link>
              .
            </p>

            <p>
              <strong>5. Acceptable Use.</strong> You agree not to misuse the
              Service, attempt to interfere with its normal operation, or use it
              to send spam, unlawful content, or abusive messages.
            </p>

            <p>
              <strong>6. Intellectual Property.</strong> TurnQA and its logos,
              designs, and software are the property of TurnQA, Inc. or its
              licensors. You receive a limited, non-exclusive license to use the
              Service for your internal business purposes.
            </p>

            <p>
              <strong>7. Termination.</strong> We may suspend or terminate
              access to the Service if you violate these Terms or use the
              Service in a way that may cause harm. You may stop using the
              Service at any time.
            </p>

            <p>
              <strong>8. Disclaimer of Warranties.</strong> The Service is
              provided on an &quot;as-is&quot; and &quot;as-available&quot;
              basis, without warranties of any kind, whether express or
              implied.
            </p>

            <p>
              <strong>9. Limitation of Liability.</strong> To the fullest extent
              permitted by law, TurnQA will not be liable for any indirect,
              incidental, special, or consequential damages, or loss of revenue
              or data, arising out of or related to your use of the Service.
            </p>

            <p>
              <strong>10. Changes to These Terms.</strong> We may update these
              Terms from time to time. If we make material changes, we will post
              the updated Terms on this page with an updated effective date.
              Your continued use of the Service after changes become effective
              constitutes your acceptance of the new Terms.
            </p>
          </div>

          <p className="hint" style={{ marginTop: 18, fontSize: 13 }}>
            Questions about these Terms?{" "}
            <Link href="/support" style={{ textDecoration: "underline" }}>
              Contact support
            </Link>
            .
          </p>
        </Card>
      </main>
    </>
  );
}
