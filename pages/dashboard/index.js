// pages/dashboard/index.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Dashboard() {
  const [session, setSession] = useState(null);
  const [org, setOrg] = useState(null);
  const [propertyName, setPropertyName] = useState('');
  const [msg, setMsg] = useState('');
  const [properties, setProperties] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function boot() {
      if (!session) return;
      setLoading(true);
      setMsg('Initializing your workspace…');
      const r = await fetch('/api/bootstrap', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      const j = await r.json();
      if (!r.ok) { setMsg(j.error || 'Bootstrap failed'); setLoading(false); return; }
      setOrg(j.org);
      setMsg('');
      await loadProperties(j.org?.id);
      setLoading(false);
    }
    boot();
  }, [session]);

  async function loadProperties(orgId) {
    if (!orgId) return;
    const { data, error } = await supabase
      .from('properties')
      .select('id, name, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false });
    if (!error) setProperties(data || []);
  }

  async function createProperty() {
    try {
      setMsg('');
      if (!org) throw new Error('Org missing');
      const { data, error } = await supabase
        .from('properties')
        .insert({ name: propertyName || 'My Property', org_id: org.id })
        .select('*').single();
      if (error) throw error;
      setPropertyName('');
      // After creation, go straight to Template builder
      window.location.href = `/properties/${data.id}/template`;
    } catch (e) {
      setMsg(e.message || 'Failed to create property');
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  const wrap = { maxWidth: 1000, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #cbd5e1', marginBottom:12 };
  const btn = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };
  const card = { border:'1px solid #e5e7eb', borderRadius:12, padding:16, background:'#fff', marginTop:16 };

  if (!session) {
    return (
      <main style={wrap}>
        <h1>Welcome to TurnQA</h1>
        <p><a href="/auth/signin">Start your free trial →</a></p>
      </main>
    );
  }

  return (
    <main style={wrap}>
      <div style={{display:'flex', justifyContent:'space-between', alignItems:'center'}}>
        <h1>Dashboard</h1>
        <button onClick={signOut} style={{...btn, background:'#fee2e2', border:'1px solid #ef4444'}}>Sign out</button>
      </div>

      <p>
        {org
          ? <>Organization: <strong>{org.name}</strong> · Trial ends {new Date(org.trial_ends_at).toLocaleDateString()}</>
          : 'Loading organization…'}
      </p>

      {/* Create property */}
      <div style={card}>
        <h2>Create a property</h2>
        <input style={input} value={propertyName} onChange={e=>setPropertyName(e.target.value)} placeholder="Property name (e.g., Glendale Unit A)" />
        <button onClick={createProperty} style={btn}>Create & go to template</button>
      </div>

      {/* Your properties */}
      <div style={card}>
        <h2>Your properties</h2>
        {loading ? <div>Loading…</div> : properties.length === 0 ? (
          <div>No properties yet. Create your first one above.</div>
        ) : (
          <div style={{display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:12}}>
            {properties.map(p => (
              <div key={p.id} style={{border:'1px solid #e5e7eb', borderRadius:10, padding:12, background:'#fafafa'}}>
                <div style={{fontWeight:600, marginBottom:6}}>{p.name}</div>
                <div style={{display:'flex', flexWrap:'wrap', gap:8}}>
                  <Link href={`/properties/${p.id}/template`} style={btn}>Template</Link>
                  <Link href={`/properties/${p.id}/invite`} style={btn}>Invite cleaner</Link>
                  <Link href={`/properties/${p.id}/start-turn`} style={btn}>Start turn</Link>
                  <Link href={`/managers/turns`} style={btn}>View turns</Link>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {msg && <div style={{marginTop:12, color:'#b91c1c'}}>{msg}</div>}
    </main>
  );
}
