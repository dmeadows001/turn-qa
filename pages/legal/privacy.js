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
  const box = { border: '1px solid #e2e8f0', borderRadius: 12, padding: 16, background: '#fff' };

  return (
    <>
      <Head>
        <title>TurnQA Privacy Policy</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="description" content="TurnQA privacy summary." />
        <link rel="canonical" href="https://www.turnqa.com/legal/privacy" />
      </Head>

      <main style={wrap}>
        <h1 style={h1}>Privacy Policy</h1>
        <p style={small}>Effective date: {new Date().toISOString().slice(0, 10)}</p>
        <div style={{...box, marginTop: 14}}>
          <p>
            TurnQA collects and processes information you provide in the app (e.g., account details, property and job data,
            phone numbers for transactional SMS). We use this information to operate the service, including sending the alerts
            you request (e.g., “turn submitted”, “turn approved”).
          </p>
          <h2 style={h2}>SMS Data</h2>
          <p>
            Phone numbers are used solely to send transactional SMS related to job activity. You can opt out of SMS by replying STOP.
          </p>
          <h2 style={h2}>Security</h2>
          <p>We use industry-standard measures to protect data in transit and at rest.</p>
          <h2 style={h2}>Contact</h2>
          <p>Questions? Email <a href="mailto:support@turnqa.com">support@turnqa.com</a>.</p>
        </div>
      </main>
    </>
  );
}
