// pages/onboard/cleaner.js
import { useEffect, useState } from 'react';

export default function CleanerOnboard() {
  const [cleanerId, setCleanerId] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [consent, setConsent] = useState(false);
  const [step, setStep] = useState('form'); // form | code | done
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const id = url.searchParams.get('id') || '';
    if (id) setCleanerId(id);
  }, []);

  async function sendCode() {
    try {
      setMsg('');
      if (!phone) throw new Error('Please enter your mobile number.');
      if (!consent) throw new Error('Please agree to SMS consent.');
      setLoading(true);
      const r = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'cleaner',
          subject_id: cleanerId || null,
          name,
          phone,
          consent
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to send code');
      if (j.subject_id) setCleanerId(j.subject_id); // IMPORTANT: keep the subject we just created/updated
      setStep('code');
      setMsg('Code sent via SMS. Check your messages and enter the 6-digit code.');
    } catch (e) {
      setMsg(e.message || 'Failed to send code');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    try {
      setMsg('');
      if (!cleanerId) throw new Error('Missing cleaner ID. Please click “Send Code” again.');
      if (!phone) throw new Error('Missing phone number.');
      if (!code) throw new Error('Enter the 6-digit code.');
      setLoading(true);
      const r = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          role: 'cleaner',
          subject_id: cleanerId,
          phone,
          code
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to verify');
      setStep('done');
      setMsg('Phone verified and SMS consent recorded. You are good to go!');
    } catch (e) {
      setMsg(e.message || 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  const wrap = { maxWidth: 520, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const card = { border:'1px solid #e5e7eb', borderRadius:12, padding:16, background:'#fff' };
  const label = { fontSize:12, color:'#475569', marginBottom:6 };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #cbd5e1', marginBottom:12 };
  const btn = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };

  return (
    <main style={wrap}>
      <h1>Cleaner Onboarding</h1>
      <div style={card}>
        {step === 'form' && (
          <>
            <div style={label}>Name</div>
            <input style={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Your name" />

            <div style={label}>Mobile Phone (E.164)</div>
            <input style={input} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+15105551234" />

            <label style={{display:'flex', gap:8, alignItems:'flex-start', margin:'8px 0 16px'}}>
              <input type="checkbox" checked={consent} onChange={e=>setConsent(e.target.checked)} />
              <span>I agree to receive transactional SMS from TurnQA. Message &amp; data rates may apply. Reply STOP to opt out, HELP for help. Consent is not a condition of purchase. See <a href="/legal/sms-terms" target="_blank" rel="noreferrer">SMS Terms</a>.</span>
            </label>

            <button disabled={loading} onClick={sendCode} style={btn}>
              {loading ? 'Sending…' : 'Send Code'}
            </button>
          </>
        )}

        {step === 'code' && (
          <>
            <div style={label}>Enter the 6-digit code we sent to {phone}</div>
            <input style={input} value={code} onChange={e=>setCode(e.target.value)} placeholder="123456" />
            <button disabled={loading} onClick={verifyCode} style={btn}>
              {loading ? 'Verifying…' : 'Verify'}
            </button>
          </>
        )}

        {step === 'done' && (
          <>
            <p>All set! You’ll receive TurnQA job alerts to {phone}.</p>
          </>
        )}

        {msg && <div style={{marginTop:12, color:'#0f172a'}}>{msg}</div>}
      </div>
    </main>
  );
}
