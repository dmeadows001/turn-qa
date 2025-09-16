// pages/dashboard/index.js
import { useEffect, useState } from 'react';
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
  const [propsList, setPropsList] = useState([]);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    async function boot() {
      if (!session) return;
      setMsg('Initializing your workspace…');
      const r = await fetch('/api/bootstrap', { method: 'POST', headers: { Authorization: `Bearer ${session.access_token}` } });
      const j = await r.json();
      if (!r.ok) return setMsg(j.error || 'Bootstrap failed');
      setOrg(j.org);
      setMsg('');
      await loadProperties(j.org?.id);
    }
    boot();
  }, [session]);

  async function loadProperties(orgId) {
    if (!orgId) return;
    const { data, error } = await supabase.from('properties').select('id, name').eq('org_id', orgId).order('created_at', { ascending: false });
    if (!error) setPropsList(data || []);
  }

  async function createProperty() {
    try {
      setMsg('');
      const { data: { user } } = await supabase.auth.getUser();
      if (!user || !org) throw new Error('not signed in');
      const { data, error } = await supabase.from('properties').insert({
        name: propertyName || 'My Property',
        org_id: org.id
      }).select('*').single();
      if (error) throw error;
      setPropertyName('');
      setMsg(`Created property "${data.name}".`);
      await loadProperties(org.id);
    } catch (e) {
      setMsg(e.message || 'Failed to create property');
    }
  }

  async function signOut() {
    await supabase.auth.signOut();
    window.location.href = '/';
  }

  const wrap = { maxWidth: 760, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
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

      <div style={card}>
        <h2>Create your first property</h2>
        <input style={input} value={propertyName} onChange={e=>setPropertyName(e.target.value)} placeholder="Property name (e.g., Glendale Unit A)" />
        <button onClick={createProperty} style={btn}>Create Property</button>

        {propsList.length > 0 && (
          <>
            <h3 style={{marginTop:16}}>Your properties</h3>
            <ul>
              {propsList.map(p => (
                <li key={p.id}>
                  {p.name} · <a href={`/onboard/manager?property_id=${p.id}`}>Assign yourself as manager</a>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>

      <div style={card}>
        <h2>Next steps</h2>
        <ol>
          <li>Assign a manager to a property (use the link above to assign yourself).</li>
          <li>Invite a cleaner: send them <code>/onboard/cleaner</code> (we’ll add an invite button next).</li>
          <li>Submit/approve a test turn to see SMS notifications fire.</li>
        </ol>
      </div>

      {msg && <div style={{marginTop:12}}>{msg}</div>}
    </main>
  );
}
