import Head from "next/head";
import Link from "next/link";
import Header from "@/components/layout/Header";
import Card from "@/components/ui/Card";

export default function Privacy() {
  return (
    <>
      <Head>
        <title>TurnQA Privacy Policy</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="description" content="TurnQA privacy summary." />
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

          <h1 className="h1 accent">Privacy Policy</h1>
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
              TurnQA is a workflow tool for property managers and cleaners. This
              Privacy Policy explains what information we collect, how we use
              it, and the choices you have.
            </p>

            <h2 className="h2">Information We Collect</h2>
            <ul style={{ paddingLeft: 20 }}>
              <li>
                <strong>Account information</strong> – name, email, and business
                details you provide.
              </li>
              <li>
                <strong>Property &amp; job data</strong> – property names,
                checklists, photos, and job status.
              </li>
              <li>
                <strong>Contact information</strong> – phone numbers for
                transactional SMS.
              </li>
              <li>
                <strong>Usage information</strong> – basic logs of access dates
                and device details.
              </li>
            </ul>

            <h2 className="h2">How We Use Information</h2>
            <ul style={{ paddingLeft: 20 }}>
              <li>Operate and improve the TurnQA service.</li>
              <li>
                Send transactional job-related notifications (submitted /
                approved).
              </li>
              <li>Respond to support requests and issues.</li>
            </ul>

            <h2 className="h2">Security</h2>
            <p>
              We use industry-standard measures to protect data in transit and
              at rest.
            </p>

            <h2 className="h2">Contact</h2>
            <p>
              Email:{" "}
              <a href="mailto:support@turnqa.com">support@turnqa.com</a>
            </p>
          </div>
        </Card>
      </main>
    </>
  );
}
