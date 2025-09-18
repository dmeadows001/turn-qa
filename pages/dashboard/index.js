// pages/dashboard/index.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Dashboard() {
  const router = useRouter();
  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [propName, setPropName] = useState('');
  const [propsList, setPropsList] = useState([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('');
        const { data, error } = await supabase
          .from('properties')
          .select('id, name, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setPropsList(data || []);
      } catch (e) {
        setMsg(e.message || 'Failed to load properties');
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  async function createProperty(e) {
    e?.preventDefault?.();
    try {
      if (!propName.trim()) {
        setMsg('Enter a property name.');
        return;
      }
      setCreating(true);
      setMsg('');
      const { data, error } = await supabase
        .from('properties')
        .insert({ name: propName.trim() })
        .select('id')
        .single();
      if (error) throw error;

      setPropName('');
      setPropsList(prev => [{ id: data.id, name: propName.trim(), created_at: new Date().toISOString() }, ...prev]);
      router.push(`/properties/${data.id}/template`);
    } catch (e) {
      setMsg(e.message || 'Could not create property');
    } finally {
      setCreating(false);
    }
  }

  // -------------- Dark theme styles with safe sizing --------------
  const page = {
    minHeight: '100vh',
    background: '#0b0b0f',
    color: '#e5e7eb',
    fontFamily: 'ui-sans-serif',
    padding: '32px 16px'
  };
  const wrap = { maxWidth: 1040, margin: '0 auto' };
  const header = { textAlign: 'center', marginBottom: 18 };
  const title = { fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' };
  const cards = { display: 'grid', gap: 16, gridTemplateColumns: '1fr' };
  const card = {
    background: '#0f172a',
    border: '1px solid #1f2937',
    borderRadius: 16,
    padding: 20,
    maxWidth: '100%',
    overflow: 'hidden'
  };
  const label = { fontSize: 13, color: '#9ca3af', marginBottom: 6, display: 'block' };
  const row = { display: 'flex', gap: 8, flexWrap: 'wrap' };
  const input = {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    boxSizing: 'border-box',
    minWidth: 0,
    padding: '12px 14px',
    borderRadius: 12,
    border: '1px solid #334155',
    background: '#111827',
    color: '#e5e7eb',
    outline: 'none'
  };
  const btnPrimary = {
    padding: '12px 16px',
    borderRadius: 12,
    border: '1px solid #38bdf8',
    background: '#0ea5e9',
    color: '#0b0b0f',
    textDecoration: 'none',
    fontWeight: 700,
    cursor: 'pointer',
    boxSizing: 'border-box'
  };
  const btnSecondary = {
    padding: '10px 14px',
    borderRadius: 10,
    border: '1px solid #334155',
    background: '#111827',
    color: '#e5e7eb',
    textDecoration: 'none',
    fontWeight: 600,
    boxSizing: 'border-box'
  };
  const muted = { color: '#9ca3af' };
  const list = { display: 'grid', gap: 10, marginTop: 8 };

  return (
    <div style={page}>
      <div style={wrap}>
        <header style={header}>
          <div style={title}>Dashboard</div>
          <div style={{ color: '#9ca3af', marginTop: 4 }}>
            Create a property, build your photo checklist, invite cleaners, and review turns.
          </div>
        </header>

        <section style={cards}>
          {/* Create Property */}
          <div style={card}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Create a property</h2>
            <form onSubmit={createProperty}>
              <label htmlFor="propname" style={label}>Property name</label>
              <div style={{ ...row }}>
                <input
                  id="propname"
                  type="text"
                  placeholder="e.g., Glendale — 2BR Condo"
                  style={{ ...input, flex: 1, minWidth: 220 }}
                  value={propName}
                  onChange={e => setPropName(e.target.value)}
                />
                <button type="submit" disabled={creating} style={btnPrimary}>
                  {creating ? 'Creating…' : 'Create & build checklist'}
                </button>
              </div>
            </form>
            {msg && <div style={{ marginTop: 10, color: '#fca5a5' }}>{msg}</div>}
          </div>

          {/* Your Properties */}
          <div style={card}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Your properties</h2>
            {loading ? (
              <div>Loading…</div>
            ) : propsList.length === 0 ? (
              <div style={muted}>No properties yet. Create one above to get started.</div>
            ) : (
              <div style={list}>
                {propsList.map(p => (
                  <div key={p.id} style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    border: '1px solid #1f2937',
                    borderRadius: 12,
                    padding: 12
                  }}>
                    <div style={{ fontWeight: 600 }}>{p.name}</div>
                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      <Link href={`/properties/${p.id}/template`} style={btnSecondary}>Checklist</Link>
                      <Link href={`/properties/${p.id}/invite`} style={btnSecondary}>Invite cleaner</Link>
                      <Link href={`/properties/${p.id}/start-turn`} style={btnSecondary}>Start turn</Link>
                      <Link href={`/managers/turns`} style={btnSecondary}>Review turns</Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}
