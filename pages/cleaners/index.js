// pages/cleaners/index.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';

function Field({ label, children }) {
  return (
    <label style={{ display:'block', marginBottom:12 }}>
      <div style={{ fontWeight:600, fontSize:14, marginBottom:6 }}>{label}</div>
      {children}
    </label>
  );
}

export default function Cleaners() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const [propsLoading, setPropsLoading] = useState(true);
  const [properties, setProperties] = useState([]);
  const [name, setName] = useState('');
  const [dateStr, setDateStr] = useState(() => new Date().toISOString().slice(0,10));
  const [propertyId, setPropertyId] = useState('');

  useEffect(() => {
    async function fetchProps() {
      setPropsLoading(true);
      try {
        const r = await fetch('/api/list-properties');
        const json = await r.json();
        setProperties(json.properties || []);
      } catch (e) {
        console.error(e);
        alert('Could not load properties.');
      } finally {
        setPropsLoading(false);
      }
    }
    fetchProps();
  }, []);

  async function startTurn(e) {
    e.preventDefault();
    if (!name.trim()) return alert('Please enter your name.');
    if (!propertyId) return alert('Please choose a property.');

    setLoading(true);
    try {
      const r = await fetch('/api/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cleaner_name: name.trim(),
          date: dateStr,
          property_id: propertyId
        })
      });
      const json = await r.json();
      if (!r.ok) {
        console.error(json);
        alert(json.error || 'Failed to start turn.');
        return;
      }
      const turnId = json.turn_id;
      // Pass cleaner name along (helpful context in UI/logs)
      router.push(`/turns/${turnId}/capture?cleaner=${encodeURIComponent(name.trim())}`);
    } finally {
      setLoading(false);
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc' }}>
      <div style={{ maxWidth:600, margin:'0 auto', padding:'28px 16px' }}>
        <h1 style={{ margin:'6px 0 4px', fontSize:28, color:'#0f172a' }}>Cleaners — Start Your Turn</h1>
        <p style={{ color:'#475569', marginTop:4 }}>
          Enter your info, pick the property, and we’ll load the required photo checklist.
        </p>

        <form onSubmit={startTurn} style={{ marginTop:18, background:'#fff', padding:16, border:'1px solid #e5e7eb', borderRadius:12 }}>
          <Field label="Your Name">
            <input
              value={name}
              onChange={e=>setName(e.target.value)}
              placeholder="e.g., Jessica"
              style={{ width:'100%', padding:'12px 10px', borderRadius:10, border:'1px solid #cbd5e1', fontSize:16 }}
            />
          </Field>

          <Field label="Date">
            <input
              type="date"
              value={dateStr}
              onChange={e=>setDateStr(e.target.value)}
              style={{ width:'100%', padding:'12px 10px', borderRadius:10, border:'1px solid #cbd5e1', fontSize:16 }}
            />
          </Field>

          <Field label="Property">
            <select
              value={propertyId}
              onChange={e=>setPropertyId(e.target.value)}
              disabled={propsLoading}
              style={{ width:'100%', padding:'12px 10px', borderRadius:10, border:'1px solid #cbd5e1', fontSize:16, background:'#fff' }}
            >
              <option value="">{propsLoading ? 'Loading…' : 'Select a property'}</option>
              {(properties || []).map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </select>
          </Field>

          <button
            type="submit"
            disabled={loading || propsLoading}
            style={{
              width:'100%', marginTop:8, padding:'14px 16px', fontWeight:700, fontSize:16,
              background:'#0284c7', color:'#fff', border:'none', borderRadius:12, cursor:'pointer'
            }}
          >
            {loading ? 'Starting…' : 'Start Turn'}
          </button>
        </form>

        <div style={{ textAlign:'center', marginTop:14 }}>
          <a href="/" style={{ color:'#0369a1', textDecoration:'none' }}>← Back to home</a>
        </div>
      </div>
    </div>
  );
}
