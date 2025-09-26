// pages/onboard/cleaner.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

// helpers
function normalizePhone(s = '') {
  const digits = (s || '').replace(/[^\d+]/g, '');
  return digits ? (digits.startsWith('+') ? digits : `+${digits}`) : '';
}
function maskPhone(p) {
  if (!p || p.length < 4) return p || '';
  return `•• •• •• ${p.slice(-4)}`;
}
async function fetchInvite(inviteId) {
  const r = await fetch(`/api/invite/cleaner?id=${encodeURIComponent(inviteId)}`);
  if (!r.ok) throw new Error((await r.json()).error || 'Load failed.');
  const j = await r.json();
  // normalize shape
  const inv = j.invite || j.data || j;
  return {
    id: inv.id,
    name: inv.name || '',
    phone: normalizePhone(inv.phone || ''),
    property_id: inv.property_id || null,
    property_name: inv.property_name || ''
  };
}

export default function CleanerOnboard() {
  const { query } = useRouter();
  const inviteId = query?.id;

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [invite, setInvite] = useState(null);

  // OTP
  const phone = useMemo(() => normalizePhone(invite?.phone || ''), [invite]);
  const [otpSent, setOtpSent] = useState(false);
  const [code, setCode] = useState('');
  const [sending, setSending] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [done, setDone] = useState(false);

  useEffect(() => {
    if (!inviteId) return;
    (async () => {
      setLoading(true); setErr('');
      try { setInvite(await fetchInvite(inviteId)); }
      catch (e) { setErr(e.message || 'Load failed.'); }
      finally { setLoading(false); }
    })();
  }, [inviteId]);

  async function sendCode() {
    if (!phone) return setErr('Missing phone.');
    setErr('');
    try {
      setSending(true);
      const r = await fetch('/api/sms/otp-send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, purpose: 'cleaner_onboard', invite_id: inviteId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not send code.');
      setOtpSent(true);
    } catch (e) {
      setErr(e.message || 'Could not send code.');
    } finally {
      setSending(false);
    }
  }

  async function verifyCode() {
    if (!phone) return setErr('Missing phone.');
    if (!code || code.length < 4) return setErr('Enter the 6-digit code.');
    setErr('');
    try {
      setVerifying(true);
      const r = await fetch('/api/sms/otp-verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone, code, purpose: 'cleaner_onboard', invite_id: inviteId })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not verify code.');

      // 1) remember phone for /capture
      try { localStorage.setItem('turnqa_cleaner_phone', phone); } catch {}

      // 2) accept invite => creates property_cleaners assignment
      if (inviteId) {
        try {
          await fetch('/api/invite/accept', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ invite_id: inviteId, phone })
          });
        } catch {}
      }

      setDone(true);
    } catch (e) {
      setErr(e.message || 'Could not verify code.');
    } finally {
      setVerifying(false);
    }
  }

  const buttonPrimary = (disabled = false) => ({
    ...ui.buttonPrimary,
    opacity: disabled ? 0.6 : 1,
    cursor: disabled ? 'not-allowed' : 'pointer'
  });

  return (
    <ChromeDark title="Cleaner Onboarding">
      <div style={{ maxWidth: 980, margin: '32px auto', padding: '0 16px' }}>
        <div style={{ ...ui.card, margin: '0 auto', maxWidth: 680 }}>
          {loading ? (
            <div style={{ color:'#9ca3af' }}>Loading…</div>
          ) : err ? (
            <div style={{ color:'#fca5a5' }}>{err}</div>
          ) : done ? (
            <>
              <div style={{ fontSize: 24, fontWeight: 800, color:'#e2e8f0', marginBottom: 8 }}>
                Welcome, {invite?.name || 'Cleaner'} 👋
              </div>
              {invite?.property_name ? (
                <div style={{ color:'#cbd5e1', marginBottom: 12 }}>
                  You’ve been invited to clean: <b>{invite.property_name}</b>
                </div>
              ) : null}
              <div style={{ background:'#052e1a', border:'1px solid #065f46', color:'#d1fae5',
                            padding:'10px 12px', borderRadius: 10, marginTop: 8 }}>
                ✅ Phone verified and invite accepted. You’re all set.
              </div>
              <div style={{ marginTop: 14, color:'#cbd5e1' }}>
                Next: start a turn to take photos for review and get paid.
              </div>
              <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
                <a href={`/capture?pid=${invite?.property_id || ''}&from=onboard`} style={ui.buttonPrimary}>
                  Start a turn now
                </a>
                <a href="/" style={ui.buttonLink}>Back home</a>
              </div>
            </>
          ) : (
            <>
              <div style={{ fontSize: 24, fontWeight: 800, color:'#e2e8f0' }}>
                Welcome, {invite?.name || 'Cleaner'} 👋
              </div>
              {invite?.property_name ? (
                <div style={{ color:'#cbd5e1', marginTop: 6 }}>
                  You’ve been invited to clean: <b>{invite.property_name}</b>
                </div>
              ) : null}
              <div style={{ color:'#94a3b8', marginTop: 10 }}>
                We’ll text important updates to: <b>{maskPhone(phone)}</b>
              </div>
              <div style={{ marginTop: 12 }}>
                <button onClick={sendCode} disabled={sending} style={buttonPrimary(sending)}>
                  {sending ? 'Sending…' : 'Text me a code'}
                </button>
              </div>
              <div style={{ marginTop: 14 }}>
                <div style={{ fontSize: 13, fontWeight: 700, color:'#94a3b8', marginBottom: 6 }}>
                  Enter the 6-digit code
                </div>
                <div style={{ display:'flex', gap:10, flexWrap:'wrap', alignItems:'center' }}>
                  <input
                    value={code}
                    onChange={e => setCode(e.target.value)}
                    placeholder="123456"
                    inputMode="numeric"
                    maxLength={6}
                    style={{ ...ui.input, width: 220 }}
                  />
                  <button onClick={verifyCode} disabled={verifying || !code} style={buttonPrimary(verifying || !code)}>
                    {verifying ? 'Verifying…' : 'Verify & finish'}
                  </button>
                </div>
              </div>
              <div style={{ display:'flex', gap:10, marginTop:16, flexWrap:'wrap' }}>
                <a href="/" style={ui.buttonLink}>← Back home</a>
              </div>
              {err && <div style={{ marginTop: 12, color:'#fca5a5' }}>{err}</div>}
            </>
          )}
        </div>
      </div>
    </ChromeDark>
  );
}
