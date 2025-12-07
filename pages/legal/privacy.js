// pages/legal/privacy.js
import Head from 'next/head';

export default function Privacy() {
  const wrap = {
    maxWidth: 900,
    margin: '40px auto',
    padding: '0 16px',
    fontFamily: 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial',
    lineHeight: 1.55,
    color: '#0f172a',
  };
  const h1 = { fontSize: 32, marginBottom: 10 };
  const h2 = { fontSize: 20, marginTop: 24, marginBottom: 6 };
  const small = { color: '#64748b', fontSize: 14 };
  const box = {
    border: '1px solid #e2e8f0',
    borderRadius: 12,
    padding: 16,
    background: '#ffffff',
  };

  return (
    <>
      <Head>
        <title>TurnQA Privacy Policy</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="description" content="How TurnQA collects, uses, and protects your data." />
        <link rel="canonical" href="https://www.turnqa.com/legal/privacy" />
      </Head>

      <main style={wrap}>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={small}>Effective date: {new Date().toISOString().slice(0, 10)}</p>

        <div style={{ ...box, marginTop: 14 }}>
          <p>
            TurnQA is a workflow tool for property managers and cleaners. This Privacy Policy explains
            what information we collect, how we use it, and the choices you have.
          </p>

          <h2 style={h2}>Information We Collect</h2>
          <p>We may collect the following types of information when you use TurnQA:</p>
          <ul>
            <li>
              <strong>Account information</strong> – such as your name, email address, and business
              details you provide when creating an account.
            </li>
            <li>
              <strong>Property and job data</strong> – including property names, checklists, photos,
              and job status information.
            </li>
            <li>
              <strong>Contact information</strong> – phone numbers for managers and cleaners so we can
              send transactional SMS related to job activity.
            </li>
            <li>
              <strong>Usage information</strong> – basic logs about how you access and use the service
              (for example, dates of access and basic device information).
            </li>
          </ul>

          <h2 style={h2}>How We Use Information</h2>
          <p>We use the information we collect to:</p>
          <ul>
            <li>Provide, operate, and improve the TurnQA service;</li>
            <li>Send transactional notifications about job status (e.g., turn submitted/approved);</li>
            <li>Respond to support requests and communicate about your account; and</li>
            <li>Maintain the security and reliability of the service.</li>
          </ul>
          <p>
            We do <strong>not</strong> use your phone number or your cleaners’ phone numbers to send
            marketing or promotional SMS messages.
          </p>

          <h2 style={h2}>SMS Data</h2>
          <p>
            Phone numbers are used solely to send SMS messages related to TurnQA job activity, such as
            invitations, submission alerts, and approval notifications. Message and data rates may
            apply, depending on your mobile plan.
          </p>
          <p>
            You can opt out of SMS at any time by replying <strong>STOP</strong>. Reply{' '}
            <strong>HELP</strong> for help. For more details, see our{' '}
            <a href="/legal/sms-terms">SMS Terms &amp; Consent</a>.
          </p>

          <h2 style={h2}>Sharing of Information</h2>
          <p>
            We do not sell your personal information. We may share data with trusted service providers
            (for example, cloud hosting or SMS providers) who help us operate TurnQA, and only as
            necessary to provide the service.
          </p>
          <p>
            We may also disclose information if required to do so by law or to protect the rights,
            property, or safety of TurnQA, our users, or others.
          </p>

          <h2 style={h2}>Security</h2>
          <p>
            We use industry-standard safeguards to protect information in transit and at rest. No
            method of transmission or storage is 100% secure, but we work to keep your data
            appropriately protected.
          </p>

          <h2 style={h2}>Your Choices</h2>
          <ul>
            <li>You may update or correct your account information within the TurnQA dashboard.</li>
            <li>You may opt out of SMS by replying STOP to any message.</li>
            <li>
              You may request deletion of your account by contacting us at{' '}
              <a href="mailto:support@turnqa.com">support@turnqa.com</a>.
            </li>
          </ul>

          <h2 style={h2}>Changes to This Policy</h2>
          <p>
            We may update this Privacy Policy from time to time. If we make material changes, we will
            post the updated policy on this page with a new effective date.
          </p>

          <h2 style={h2}>Contact</h2>
          <p>
            Questions or concerns? Email us at{' '}
            <a href="mailto:support@turnqa.com">support@turnqa.com</a>.
          </p>
        </div>
      </main>
    </>
  );
}
