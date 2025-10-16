// pages/admin/properties.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

export default function PropertiesAdmin() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [address, setAddress] = useState('');
  const [creating, setCreating] = useState(false);

  async function load() {
    setLoading(true);
    const r = await fetch('/api/properties');
    const j = await r.json();
    setItems(j.properties || []);
    setLoading(false);
  }
  useEffect(() => { load(); }, []);

  async function createProperty(e) {
    e.preventDefault();
    if (!name.trim()) {
      alert('Name is required');
      return;
    }
    setCreating(true);
    const r = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address })
    });
    setCreating(false);
    if (!r.ok) {
      const j = await r.json().catch(() => ({}));
      alert('Create failed: ' + (j.error || r.statusText));
      return;
    }
    setName('');
    setAddress('');
    load();
  }

  return (
    <ChromeDark title="Properties">
      <section style={ui.sectionGrid}>
        {/* Create panel */}
        <div style={ui.card}>
          <form
            onSubmit={createProperty}
            style={{
              display: 'grid',
              gridTemplateColumns: '1fr 1fr auto',
              gap: 12,
              alignItems: 'end'
            }}
          >
            <div>
              <label htmlFor="prop-name" style={ui.label}>Name</label>
              <input
                id="prop-name"
                value={name}
                onChange={e => setName(e.target.value)}
                placeholder="Beach House A"
                aria-label="Property name"
                type="text"
                style={ui.input}
              />
            </div>
            <div>
              <label htmlFor="prop-address" style={ui.label}>Address (optional)</label>
              <input
                id="prop-address"
                value={address}
                onChange={e => setAddress(e.target.value)}
                placeholder="123 Palm St"
                aria-label="Property address"
                type="text"
                style={ui.input}
              />
            </div>
            <button disabled={creating} aria-busy={creating} style={ui.btnPrimary}>
              {creating ? 'Creating…' : '➕ Create'}
            </button>
          </form>
        </div>

        {/* List panel */}
        <div style={ui.card}>
          {loading ? (
            <div style={ui.muted}>Loading…</div>
          ) : items.length === 0 ? (
            <div style={ui.muted}>No properties yet.</div>
          ) : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr>
                  <th style={{ ...ui.sectionTitle, textTransform:'none', fontSize:14, color: ui.muted.color, background:'transparent', padding:'8px 12px', textAlign:'left' }}>Name</th>
                  <th style={{ ...ui.sectionTitle, textTransform:'none', fontSize:14, color: ui.muted.color, background:'transparent', padding:'8px 12px', textAlign:'left' }}>Address</th>
                  <th style={{ ...ui.sectionTitle, textTransform:'none', fontSize:14, color: ui.muted.color, background:'transparent', padding:'8px 12px', textAlign:'left' }}>Created</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {items.map(p => (
                  <tr key={p.id} style={{ borderTop:'1px solid #334155' }}>
                    <td style={{ padding:'10px 12px' }}>{p.name}</td>
                    <td style={{ padding:'10px 12px', opacity:.8 }}>{p.address}</td>
                    <td style={{ padding:'10px 12px', opacity:.8 }}>{new Date(p.created_at).toLocaleString()}</td>
                    <td style={{ padding:'10px 12px' }}>
                      <Link href={`/admin/properties/${p.id}`} style={{ ...ui.btnSecondary, textDecoration:'none' }}>
                        Edit Template →
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>
    </ChromeDark>
  );
}
