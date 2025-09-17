// pages/properties/[id]/invite.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function InviteCleaner() {
  const router = useRouter();
  const { id: propertyId } = router.query;

  const [prop, setProp] = useState(null);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      try {
        setLoading(true);
        const { data, error } = await supabase
          .from('properties')
          .select('id, name')
          .eq('id', propertyId)
          .single();
        if (error) throw error;
        setProp(data);
        setMsg('');
      } catch (e) {
        setMsg(e.message || 'Failed to load property');
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  async function sendInvite() {
    try {
      setMsg('');
      if (!propertyId) throw new Error('Missing property id.');
      if (!phone) throw new Error('Enter cleaner phone (E.164).');
      setSending(true);
      const r = await fetch('/api/invite/cleaner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: propertyId, cleaner_name: name, cleaner_phone: phone })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to send invite');
      setMsg(`Invite sent to ${phone}. Onboarding link: ${j.link}`);
      setName('');
      setPhone('');
    } catch (e) {
      setMsg(e.message || 'Failed to send invite');
    } finally {
      setSending(false);
    }
  }

  const wrap = { maxWidth: 560, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const card = { border:'1px solid #e5e7eb', borderRadius:12, padding:16, background:'#fff' };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #cbd5e1', marginBottom:12 };
  const btn = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };

  return (
    <main style={wrap}>
      <h1>Invite a cleaner {prop ? `— ${prop.name}` : ''}</h1>

      <div style={card}>
        {loading ? (
          <div>Loading property…</div>
        ) : (
          <>
            <div style={{ fontSize:12, color:'#475569', marginBottom:4 }}>Cleaner name (optional)</div>
            <input style={input} value={name} onChange={e=>setName(e.target.value)} placeholder="e.g., Sam Rivera" />

            <div style={{ fontSize:12, color:'#475569', marginBottom:4 }}>Cleaner mobile (E.164)</div>
            <input style={input} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+15105551234" />

            <button disabled={sending || !phone} onClick={sendInvite} style={btn}>
              {sending ? 'Sending…' : 'Send SMS invite'}
            </button>

            <div style={{ marginTop:12 }}>
              {prop && (
                <>
                  <a href={`/properties/${prop.id}/template`}>← Back to template</a> ·{' '}
                </>
              )}
              <a href="/dashboard">Back to dashboard</a>
            </div>

            {msg && <div style={{ marginTop:12, color: msg.startsWith('Invite sent') ? '#065f46' : '#b91c1c' }}>{msg}</div>}
          </>
        )}
      </div>
    </main>
  );
}
