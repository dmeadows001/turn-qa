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
    if (!name.trim()) return alert('Name is required');
    setCreating(true);
    const r = await fetch('/api/properties', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name, address })
    });
    setCreating(false);
    if (!r.ok) {
      const j = await r.json().catch(()=>({}));
      alert('Create failed: ' + (j.error || r.statusText));
      return;
    }
    setName(''); setAddress('');
    load();
  }

  return (
    <div style={{ maxWidth: 900, margin: '24px auto', padding: '0 16px', fontFamily:'ui-sans-serif' }}>
      <h1>Properties</h1>

      <form onSubmit={createProperty} style={{ display:'grid', gridTemplateColumns:'1fr 1fr auto', gap:8, alignItems:'end', margin:'12px 0 24px' }}>
        <div>
          <label style={{ fontSize:12, color:'#555' }}>Name</label>
          <input value={name} onChange={e=>setName(e.target.value)} placeholder="Beach House A" style={{ width:'100%', padding:8 }}/>
        </div>
        <div>
          <label style={{ fontSize:12, color:'#555' }}>Address (optional)</label>
          <input value={address} onChange={e=>setAddress(e.target.value)} placeholder="123 Palm St" style={{ width:'100%', padding:8 }}/>
        </div>
        <button disabled={creating} style={{ padding:'10px 14px' }}>➕ Create</button>
      </form>

      {loading ? <div>Loading…</div> : (
        items.length === 0 ? <div>No properties yet.</div> : (
          <table width="100%" cellPadding="8" style={{ borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#f8fafc', textAlign:'left' }}>
                <th>Name</th>
                <th>Address</th>
                <th>Created</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(p => (
                <tr key={p.id} style={{ borderTop:'1px solid #e5e7eb' }}>
                  <td>{p.name}</td>
                  <td>{p.address}</td>
                  <td>{new Date(p.created_at).toLocaleString()}</td>
                  <td><Link href={`/admin/properties/${p.id}`} style={{ color:'#2563eb' }}>Edit Template →</Link></td>
                </tr>
              ))}
            </tbody>
          </table>
        )
      )}
    </div>
  );
}

