// pages/legal/sms-terms.js
import Head from 'next/head';

export default function SmsTerms() {
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
  const code = { background: '#f1f5f9', padding: '2px 6px', borderRadius: 6 };

  return (
    <>
      <Head>
        <title>TurnQA SMS Terms &amp; Consent</title>
        <meta name="robots" content="noindex,nofollow" />
        <meta name="description" content="TurnQA SMS terms, opt-in, opt-out, and consent details for transactional notifications." />
        <link rel="canonical" href="https://www.turnqa.com/legal/sms-terms" />
      </Head>

      <main style={wrap}>
        <h1 style={h1}>TurnQA SMS Terms &amp; Consent</h1>
        <p style={small}>Effective date: {new Date().toISOString().slice(0, 10)}</p>

        <div style={{...box, marginTop: 14}}>
          <p><strong>Program Name:</strong> TurnQA Alerts</p>
          <p><strong>Description:</strong> We send <em>transactional</em> SMS related to short-term rental (STR) cleaning operations. 
            When a cleaner submits a completed “turn” in the TurnQA app, we notify the assigned property manager. 
            When the manager approves the turn, we notify the cleaner. No marketing or promotional content.</p>

          <h2 style={h2}>Opt-In &amp; Consent</h2>
          <p>
            Managers and cleaners are invited or added by an authorized host/manager inside the TurnQA app. During onboarding,
            users consent to receive SMS alerts related to their jobs by agreeing to the checkbox shown, for example:
          </p>
          <p style={{marginLeft:16}}>
            <span style={code}>
              I agree to receive transactional SMS from TurnQA at the number provided. Message &amp; data rates may apply. 
              Reply STOP to opt out, HELP for help. Consent is not a condition of purchase.
            </span>
          </p>
          <p>
            By providing your mobile number and selecting the consent checkbox, you authorize TurnQA to send transactional SMS as described above.
          </p>

          <h2 style={h2}>Opt-Out</h2>
          <p>Reply <strong>STOP</strong> at any time to cancel SMS. You may also contact us at <a href="mailto:support@turnqa.com">support@turnqa.com</a> to be removed.</p>

          <h2 style={h2}>Help</h2>
          <p>Reply <strong>HELP</strong> for assistance. You can also email <a href="mailto:support@turnqa.com">support@turnqa.com</a>.</p>

          <h2 style={h2}>Message Frequency</h2>
          <p>Event-driven; typically 1–2 messages per job (submission and approval). Frequency varies with account activity.</p>

          <h2 style={h2}>Fees</h2>
          <p>Message and data rates may apply. Check your mobile plan for details.</p>

          <h2 style={h2}>Eligibility</h2>
          <p>U.S. recipients only for this SMS program. Delivery depends on carrier availability and device support.</p>

          <h2 style={h2}>Carrier Disclosure</h2>
          <p>Carriers are not liable for delayed or undelivered messages.</p>

          <h2 style={h2}>Privacy</h2>
          <p>
            We respect your privacy. See our <a href="/legal/privacy">Privacy Policy</a> to learn how we handle information.
          </p>

          <h2 style={h2}>Contact</h2>
          <p>
            TurnQA, Inc. (or applicable business entity) — <a href="mailto:support@turnqa.com">support@turnqa.com</a>
          </p>
        </div>
      </main>
    </>
  );
}
