// pages/capture/index.js
import { useEffect, useState } from 'react';
import ChromeDark from '@/components/ChromeDark';
import { ui } from '@/lib/theme';

export default function CaptureIndex() {
  const [me, setMe] = useState(null);                 // { id, name, phone }
  const [properties, setProperties] = useState([]);   // [{id, name}]
  const [propertyId, setPropertyId] = useState('');
  const [loading, setLoading] = useState(false);
  const [msg, setMsg] = useState('');

  // prettier select caret for dark theme
  const selectStyle = {
    ...ui.input,
    appearance: 'none',
    WebkitAppearance: 'none',
    MozAppearance: 'none',
    paddingRight: 40,
    backgroundImage:
      `url("data:image/svg+xml;utf8,` +
      `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24' width='20' height='20' ` +
      `fill='none' stroke='%2394a3b8' stroke-width='2' stroke-linecap='round' stroke-linejoin='round'>` +
      `<polyline points='6 9 12 15 18 9'/></svg>")`,
    backgroundRepeat: 'no-repeat',
    backgroundPosition: 'right 12px center',
    backgroundSize: 18,
  };

  // load session + properties for this cleaner
  useEffect(() => {
    (async () => {
      try {
        setMsg('');
        const meResp = await fetch('/api/me/cleaner');
        const meJson = await meResp.json();
        if (!meResp.ok) throw new Error(meJson.error || 'Not signed in');
        setMe(meJson.cleaner);

        const propsResp = await fetch(`/api/list-my-properties?cleaner_id=${meJson.cleaner.id}`);
        const propsJson = await propsResp.json();
        if (!propsResp.ok) throw new Error(propsJson.error || 'Failed to load properties');

        const rows = Array.isArray(propsJson.rows) ? propsJson.rows : [];
        setProperties(rows);
        if (rows.length) setPropertyId(rows[0].id);
      } catch (e) {
        setMsg(e.message || 'Could not load your properties');
      }
    })();
  }, []);

  async function startTurn() {
    if (!propertyId || !me?.id) return;
    setLoading(true);
    setMsg('');
    try {
      const r = await fetch('/api/cleaner/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId, cleaner_id: me.id }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Start failed');

      // go straight to the capture UI for this new turn
      window.location.href = `/turns/${j.turn_id}/capture`;
    } catch (e) {
      setMsg(e.message || 'Could not start turn');
    } finally {
      setLoading(false);
    }
  }

  const card = (
    <div style={ui.card}>
      {/* Inner heading changed to “Start turn” to avoid duplicate “Capture” */}
      <h2 style={{ marginTop: 0, marginBottom: 12, color: '#fff' }}>Start turn</h2>

      {me?.phone && (
        <div style={{ ...ui.subtle, marginBottom: 10 }}>
          Signed in as <span style={{ color: '#cbd5e1' }}>{me.phone}</span>.
        </div>
      )}

      <label style={ui.label}>Choose a property</label>
      <select
        value={propertyId}
        onChange={(e) => setPropertyId(e.target.value)}
        style={selectStyle}
      >
        {properties.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name || p.id}
          </option>
        ))}
      </select>

      <div style={{ marginTop: 12 }}>
        <button
          onClick={startTurn}
          disabled={loading || !propertyId}
          style={{ ...ui.btnPrimary, width: '100%' }}
        >
          {loading ? 'Starting…' : 'Start turn'}
        </button>
      </div>

      {msg && <div style={{ marginTop: 10, color: '#fca5a5' }}>{msg}</div>}
    </div>
  );

  return (
    <ChromeDark title="Capture">
      <section style={ui.sectionGrid}>
        {card}
      </section>
    </ChromeDark>
  );
}
