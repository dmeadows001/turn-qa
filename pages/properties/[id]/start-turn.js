// pages/properties/[id]/start-turn.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function StartTurn() {
  const router = useRouter();
  const { id: propertyId } = router.query;

  const [session, setSession] = useState(null);
  const [prop, setProp] = useState(null);
  const [cleaners, setCleaners] = useState([]);
  const [selected, setSelected] = useState('');
  const [notes, setNotes] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  // get the Supabase session (for access_token)
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // load property + cleaners (requires auth header)
  useEffect(() => {
    if (!propertyId || !session?.access_token) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('Loading…');

        // load property name (for page title)
        const { data: p, error: pErr } = await supabase
          .from('properties')
          .select('id, name')
          .eq('id', propertyId)
          .single();
        if (pErr) throw pErr;
        setProp(p);

        // load SMS-consented cleaners in org via secure API
        const r = await fetch(`/api/org/cleaners?property_id=${propertyId}`, {
          headers: { Authorization: `Bearer ${session.access_token}` }
        });
        const j = await r.json();
        if (!r.ok) throw new Error(j.error || 'Failed to load cleaners');
        setCleaners(j.cleaners || []);
        setMsg('');
      } catch (e) {
        setMsg(e.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId, session?.access_token]);

  async function startTurn() {
    try {
      if (!selected) throw new Error('Choose a cleaner first.');
      setSending(true);
      setMsg('');
      const r = await fetch('/api/turns/create', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${session?.access_token || ''}`
        },
        body: JSON.stringify({ property_id: propertyId, cleaner_id: selected, notes })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to start turn');
      setMsg(`Turn started and capture link SMS sent. Turn ID: ${j.turn?.id}`);
    } catch (e) {
      setMsg(e.message || 'Failed to start turn');
    } finally {
      setSending(false);
    }
  }

  const wrap = { maxWidth: 560, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const card = { border:'1px solid #e5e7eb', borderRadius:12, padding:16, background:'#fff' };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #cbd5e1', marginBottom:12 };
  const btn = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };
  const muted = { fontSize:12, color:'#475569', marginBottom:4 };

  const noneFound = !loading && cleaners.length === 0;

  return (
    <main style={wrap}>
      <h1>Start Turn{prop ? ` — ${prop.name}` : ''}</h1>

      <div style={card}>
        <div style={muted}>Cleaner</div>

        {loading ? (
          <div>Loading…</div>
        ) : noneFound ? (
          <div style={{marginBottom:12}}>
            No SMS-ready cleaners found for this property’s organization.
            <div style={{marginTop:8}}>
              <a href={`/properties/${propertyId}/invite`}>Invite a cleaner</a> and have them complete SMS verification,
              then return here.
            </div>
          </div>
        ) : (
          <select value={selected} onChange={e=>setSelected(e.target.value)} style={input}>
            <option value="">Select a cleaner</option>
            {cleaners.map(c => (
              <option key={c.id} value={c.id}>
                {(c.name || 'Cleaner')} — {c.phone}
              </option>
            ))}
          </select>
        )}

        <div style={muted}>Notes (optional)</div>
        <textarea
          style={{...input, minHeight:100}}
          value={notes}
          onChange={e=>setNotes(e.target.value)}
          placeholder="Any special instructions"
        />

        <button
          disabled={sending || noneFound || !selected}
          onClick={startTurn}
          style={btn}
        >
          {sending ? 'Sending…' : 'Send capture link & start'}
        </button>

        <div style={{ marginTop:12 }}>
          <a href={`/properties/${propertyId}/template`}>← Back to template</a> · <a href="/dashboard">Back to dashboard</a>
        </div>

        {msg && (
          <div style={{marginTop:12, color: msg.startsWith('Turn started') ? '#065f46' : '#b91c1c'}}>
            {msg}
          </div>
        )}
      </div>
    </main>
  );
}
