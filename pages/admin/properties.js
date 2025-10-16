// pages/admin/properties.js
import { useEffect, useState } from 'react';
import Link from 'next/link';

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
    <main className="page-wrap">
      <div className="page-card">
        <h1 className="text-2xl font-bold mb-4">Properties</h1>

        <form
          onSubmit={createProperty}
          style={{ display: 'grid', gridTemplateColumns: '1fr 1fr auto', gap: 12, alignItems: 'end', margin: '12px 0 20px' }}
        >
          <div>
            <label htmlFor="prop-name" style={{ fontSize: 12, opacity: .8 }}>Name</label>
            <input
              id="prop-name"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="Beach House A"
              aria-label="Property name"
            />
          </div>
          <div>
            <label htmlFor="prop-address" style={{ fontSize: 12, opacity: .8 }}>Address (optional)</label>
            <input
              id="prop-address"
              value={address}
              onChange={e => setAddress(e.target.value)}
              placeholder="123 Palm St"
              aria-label="Property address"
            />
          </div>
          <button className="btn" disabled={creating} aria-busy={creating}>
            {creating ? 'Creating…' : '➕ Create'}
          </button>
        </form>

        {loading ? (
          <div className="muted">Loading…</div>
        ) : items.length === 0 ? (
          <div className="muted">No properties yet.</div>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: '40%' }}>Name</th>
                <th style={{ width: '35%' }}>Address</th>
                <th style={{ width: '20%' }}>Created</th>
                <th style={{ width: '5%' }} />
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id}>
                  <td>{p.name}</td>
                  <td className="opacity-80">{p.address}</td>
                  <td className="opacity-80">{new Date(p.created_at).toLocaleString()}</td>
                  <td>
                    <Link href={`/admin/properties/${p.id}`} className="underline">
                      Edit Template →
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </main>
  );
}
