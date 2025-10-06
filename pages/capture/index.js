// pages/capture/index.js
import { useEffect, useState } from 'react';
import ChromeDark from '@/components/ChromeDark';
import ResendOtpButton from '@/components/ResendOtpButton';
import { ui } from '@/lib/theme';

export default function Capture() {
  const [phase, setPhase] = useState('loading'); // loading | request | code | choose
  const [msg, setMsg] = useState(null);
  const [loading, setLoading] = useState(false);

  // phone/code input (verify flow)
  const [phone, setPhone] = useState('');
  const [code, setCode] = useState('');

  // session + property selection
  const [me, setMe] = useState(null); // { id, phone, ... }
  const [properties, setProperties] = useState([]);
  const [propertyId, setPropertyId] = useState('');

  // ---- helpers ----
  async function fetchMe() {
    try {
      const r = await fetch('/api/me/cleaner');
      if (!r.ok) return null;
      const j = await r.json();
      return j?.cleaner || null;
    } catch {
      return null;
    }
  }

  async function fetchMyProperties(cleanerId) {
    const r = await fetch(`/api/list-my-properties?cleaner_id=${encodeURIComponent(cleanerId)}`);
    const j = await r.json().catch(() => ({}));
    return Array.isArray(j.rows) ? j.rows : [];
  }

  // On load: if cookie/session exists, go straight to choose phase
  useEffect(() => {
    (async () => {
      const who = await fetchMe();
      if (who?.id) {
        setMe(who);
        const props = await fetchMyProperties(who.id);
        setProperties(props);
        if (props[0]?.id) setPropertyId(props[0].id);
        setPhase('choose');
        setPhone(who.phone || '');
      } else {
        setPhase('request');
      }
    })();
  }, []);

  // ---- actions: OTP send/verify ----
  async function sendCode() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/otp/send', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone, consent: true }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not send code');
      setPhase('code');
      setMsg('Code sent! Check your texts.');
    } catch (e) {
      setMsg(e.message || 'Send failed');
    } finally {
      setLoading(false);
    }
  }

  async function verifyCode() {
    setMsg(null);
    setLoading(true);
    try {
      const r = await fetch('/api/otp/verify', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: 'cleaner', phone, code }),
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Verify failed');

      // We now have a session cookie → fetch cleaner + properties
      const who = await fetchMe();
      if (!who?.id) throw new Error('Session not established');
      setMe(who);

      const props = await fetchMyProperties(who.id);
      setProperties(props);
      if (props[0]?.id) setPropertyId(props[0].id);

      setPhase('choose');
      setMsg('You’re verified.');
    } catch (e) {
      setMsg(e.message || 'Verify failed');
    } finally {
      setLoading(false);
    }
  }

  // ---- start turn ----
  async function startTurn() {
    setMsg(null);
    setLoading(true);
    try {
      if (!me?.id) throw new Error('Cleaner not found in session');
      if (!propertyId) throw new Error('Choose a property first');

      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cleaner_id: me.id, property_id: propertyId }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Could not start turn');

      // Navigate to camera/capture UI for this new turn
      window.location.href = `/turns/${j.turn_id}/capture`;
    } catch (e) {
      setMsg(e.message || 'Start failed');
    } finally {
      setLoading(false);
    }
  }

  // ---- UI blocks ----
  const verifyCard = (
    <div style={ui.card}>
      <div style={ui.sectionTitle}>Verify your phone</div>
      <div style={ui.sectionGrid}>
        <input
          style={ui.input}
          placeholder="+1 555 123 4567"
          value={phone}
          onChange={(e) => setPhone(e.target.value)}
        />

        {phase === 'request' ? (
          <button style={ui.button} onClick={sendCode} disabled={loading}>
            {loading ? 'Sending…' : 'Text me a code'}
          </button>
        ) : (
          <>
            <input
              style={ui.input}
              placeholder="6-digit code"
              value={code}
              onChange={(e) => setCode(e.target.value)}
              maxLength={6}
              inputMode="numeric"
              pattern="\d*"
            />
            <div style={ui.row}>
              <button style={ui.button} onClick={verifyCode} disabled={loading}>
                {loading ? 'Verifying…' : 'Verify'}
              </button>
              <ResendOtpButton phone={phone} role="cleaner" />
            </div>
          </>
        )}

        {msg && <div style={msg.startsWith('You’re') ? ui.ok : ui.hint}>{msg}</div>}
      </div>
    </div>
  );

  const chooseCard = (
    <div style={ui.card}>
      <div style={ui.sectionTitle}>Choose a property</div>
      <div style={ui.sectionGrid}>
        <select
          value={propertyId}
          onChange={(e) => setPropertyId(e.target.value)}
          style={ui.select}
        >
          {properties.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name || p.id}
            </option>
          ))}
        </select>

        <button style={ui.button} onClick={startTurn} disabled={loading || !propertyId}>
          {loading ? 'Starting…' : 'Start turn'}
        </button>

        {msg && <div style={ui.hint}>{msg}</div>}
      </div>
    </div>
  );

  const content = (
    <div style={ui.wrap(720)}>
      <header style={{ ...ui.header, textAlign: 'left' }}>
        <h1 style={ui.title}>Capture</h1>
        {me?.phone && (
          <div style={ui.subtle}>Signed in as <strong>{me.phone}</strong>.</div>
        )}
      </header>

      {phase === 'loading' && <div style={ui.hint}>Loading…</div>}
      {(phase === 'request' || phase === 'code') && verifyCard}
      {phase === 'choose' && chooseCard}
    </div>
  );

  return <ChromeDark title="Capture">{content}</ChromeDark>;
}
