// pages/onboard/cleaner.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';

function maskPhone(p = '') {
  // Show last 4 digits, keep E.164 plus sign if present
  const d = String(p).replace(/[^\d+]/g, '');
  if (!d) return '';
  const last4 = d.slice(-4);
  return `••• •• •• ${last4}`;
}

export default function CleanerOnboard() {
  const router = useRouter();
  const inviteId = router.query.id;

  const [loading, setLoading] = useState(true);
  const [propertyName, setPropertyName] = useState('');
  const [phone, setPhone] = useState('');
  const [cleanerName, setCleanerName] = useState('');
  const [msg, setMsg] = useState('');
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [otpSupported, setOtpSupported] = useState(true);
  const [done, setDone] = useState(false);

  // Load invite info (property + phone)
  useEffect(() => {
    if (!inviteId) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('Loading…');
        const r = await fetch(`/api/invite/info?id=${inviteId}`);
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Could not load invite');
        setPropertyName(j.property_name || '');
        setPhone(j.phone || '');
        setCleanerName(j.name || '');
        setMsg('');
      } catch (e) {
        setMsg(e.message || 'Could not load invite');
      } finally {
        setLoading(false);
      }
    })();
  }, [inviteId]);

  async function sendOtp() {
    try {
      setMsg('');
      setSending(true);
      // If your install has an OTP endpoint, call it; otherwise we mark unsupported
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setMsg('Code sent. Check your texts.');
    } catch (e) {
      // If 404, assume this deployment doesn’t have OTP enabled
      if (String(e.message || '').toLowerCase().includes('not found') || e.message === 'Failed to fetch') {
        setOtpSupported(false);
        setMsg('This deployment does not require a code. You are set.');
        setDone(true);
        return;
      }
      setMsg(e.message || 'Could not send code');
    } finally {
      setSending(false);
    }
  }

  async function verifyOtp() {
    try {
      setMsg('');
      setVerifying(true);
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Invalid code');
      setDone(true);
      setMsg('Phone verified. You’re good to go!');
    } catch (e) {
      setMsg(e.message || 'Verification failed');
    } finally {
      setVerifying(false);
    }
  }

  return (
    <ChromeDark title="Cleaner Onboarding">
      <div style={{ maxWidth: 560, margin: '0 auto' }}>
        <div style={{ border:'1px solid #1f2937', borderRadius:16, background:'#0b1220', padding:18 }}>
          <div style={{ fontSize:22, fontWeight:800, color:'#e5e7eb', letterSpacing:'-0.02em' }}>
            Welcome{cleanerName ? `, ${cleanerName}` : ''} 👋
          </div>
          <div style={{ marginTop:6, color:'#94a3b8' }}>
            You’ve been invited to clean: <b style={{ color:'#e2e8f0' }}>{propertyName || 'a property'}</b>
          </div>

          {loading ? (
            <div style={{ marginTop:12, color:'#cbd5e1' }}>Loading…</div>
          ) : (
            <>
              <div style={{ marginTop:16, fontSize:14, color:'#93c5fd' }}>
                We’ll text important updates to: <span style={{ color:'#e2e8f0' }}>{maskPhone(phone)}</span>
              </div>

              {!done && (
                <div style={{ marginTop:14 }}>
                  <div style={{ fontSize:12, color:'#94a3b8', marginBottom:6 }}>Verify your phone</div>

                  {/* Send code */}
                  <button
                    onClick={sendOtp}
                    disabled={sending || !phone}
                    style={{
                      padding:'10px 12px',
                      borderRadius:10,
                      border:'1px solid #2563eb',
                      background:'#0b2440',
                      color:'#cbd5e1',
                      cursor:'pointer'
                    }}
                  >
                    {sending ? 'Sending…' : 'Text me a code'}
                  </button>

                  {/* Code input + verify */}
                  {otpSupported && (
                    <>
                      <div style={{ marginTop:10, fontSize:12, color:'#94a3b8' }}>Enter the 6-digit code</div>
                      <input
                        value={code}
                        onChange={e=>setCode(e.target.value)}
                        inputMode="numeric"
                        placeholder="123456"
                        style={{
                          width:'100%', padding:10, borderRadius:10,
                          border:'1px solid #334155',
                          background:'#0f172a', color:'#e2e8f0', marginTop:6
                        }}
                      />
                      <div style={{ marginTop:10 }}>
                        <button
                          onClick={verifyOtp}
                          disabled={verifying || !code}
                          style={{
                            padding:'10px 12px',
                            borderRadius:10,
                            border:'1px solid #22c55e',
                            background:'#052e1c',
                            color:'#bbf7d0',
                            cursor:'pointer'
                          }}
                        >
                          {verifying ? 'Verifying…' : 'Verify & finish'}
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}

              {done && (
                <div style={{
                  marginTop:14, padding:12, border:'1px solid #14532d',
                  background:'#052e1c', color:'#d1fae5', borderRadius:12
                }}>
                  ✅ You’re all set. When a turn starts, you’ll get a link to take photos.
                </div>
              )}

              {msg && (
                <div style={{
                  marginTop:12, color: msg.toLowerCase().includes('fail') ? '#fecaca' : '#bbf7d0'
                }}>
                  {msg}
                </div>
              )}

              <div style={{ marginTop:14 }}>
                <a href="/"
                   style={{ color:'#93c5fd', textDecoration:'none' }}>
                  ← Back home
                </a>
              </div>
            </>
          )}
        </div>
      </div>
    </ChromeDark>
  );
}
