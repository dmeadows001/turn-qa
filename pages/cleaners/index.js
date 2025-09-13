// pages/cleaners.js
import { useEffect, useState } from 'react';

export default function CleanersStart() {
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  const [name, setName] = useState('');
  const [dateStr, setDateStr] = useState(() => {
    const d = new Date();
    return d.toISOString().slice(0, 10); // YYYY-MM-DD
  });
  const [propertyId, setPropertyId] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setLoadErr('');
      try {
        const r = await fetch('/api/list-properties');
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Failed to load properties');

        if (!cancelled) {
          setProperties(j.properties || []);
          // if exactly 1 property, preselect it
          if ((j.properties || []).length === 1) {
            setPropertyId(j.properties[0].id);
          }
        }
      } catch (e) {
        if (!cancelled) setLoadErr(e.message || 'Load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, []);

  async function startTurn() {
    if (!name.trim()) return alert('Please enter your name.');
    if (!propertyId) return alert('Please select a property.');

    try {
      // Minimal server-side start-turn (you may already have this)
      const r = await fetch('/api/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaner_name: name.trim(),
          service_date: dateStr,
          property_id: propertyId,
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Could not start');

      // Expect server to return the created/located turn id
      const turnId = j.turn_id || j.id;
      if (!turnId) throw new Error('No turn_id returned');
      window.location.href = `/turns/${turnId}/capture`;
    } catch (e) {
      alert(e.message || 'Failed to start turn.');
    }
  }

  return (
    <div style={{ maxWidth: 640, margin: '36px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1 style={{ fontSize: 34, marginBottom: 6 }}>Cleaners — Start Your Turn</h1>
      <p style={{ color: '#475569', marginBottom: 18 }}>
        Enter your info, pick the property, and we’ll load the required photo checklist.
      </p>

      {loadErr && <div style={{ color: '#b91c1c', marginBottom: 10 }}>{loadErr}</div>}

      <div style={{ background: '#fff', border: '1px solid #e5e7eb', borderRadius: 12, padding: 14 }}>
        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Your Name</div>
          <input
            value={name}
            onChange={e => setName(e.target.value)}
            placeholder="Jane"
            style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 10 }}
          />
        </div>

        <div style={{ marginBottom: 12 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Date</div>
          <input
            type="date"
            value={dateStr}
            onChange={e => setDateStr(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 10 }}
          />
        </div>

        <div style={{ marginBottom: 14 }}>
          <div style={{ fontWeight: 700, marginBottom: 6 }}>Property</div>
          <select
            value={propertyId}
            onChange={e => setPropertyId(e.target.value)}
            style={{ width: '100%', padding: 10, border: '1px solid #cbd5e1', borderRadius: 10 }}
          >
            <option value="" disabled>{loading ? 'Loading…' : 'Select a property'}</option>
            {properties.map(p => (
              <option key={p.id} value={p.id}>
                {p.name} {p.address ? `— ${p.address}` : ''}
              </option>
            ))}
          </select>
        </div>

        <button
          onClick={startTurn}
          style={{
            width: '100%', padding: '12px 14px', borderRadius: 10,
            background: '#0ea5e9', color: '#fff', fontWeight: 700, cursor: 'pointer'
          }}
        >
          Start Turn
        </button>
      </div>

      <div style={{ marginTop: 16 }}>
        <a href="/" style={{ color: '#0369a1' }}>← Back to home</a>
      </div>
    </div>
  );
}
