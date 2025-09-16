// pages/properties/[id]/invite.js
import { useRouter } from 'next/router';
import { useState } from 'react';

export default function InviteCleaner() {
  const router = useRouter();
  const { id } = router.query;

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [msg, setMsg] = useState('');
  const [loading, setLoading] = useState(false);

  async function sendInvite() {
    try {
      setMsg('');
      if (!id) throw new Error('Missing property id in URL.');
      if (!phone) throw new Error('Enter cleaner phone (E.164).');
      setLoading(true);
      const r = await fetch('/api/invite/cleaner', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ property_id: id, cleaner_name: name, cleaner_phone: phone })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Failed to send invite');
      setMsg(`Invite sent. Link: ${j.link}`);
    } catch (e) {
      setMsg(e.message || 'Failed to send invite');
    } finally {
      setLoading(false);
    }
  }

  const wrap = { maxWidth: 520, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #cbd5e1', marginBottom:12 };
  const btn = { padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer' };

  return (
    <main style={wrap}>
      <h1>Invite a Cleaner</h1>
      <p>Property: {id || '(loading...)'}</p>
      <input style={input} value={name} onChange={e=>setName(e.target.value)} placeholder="Cleaner name (optional)" />
      <input style={input} value={phone} onChange={e=>setPhone(e.target.value)} placeholder="+15105551234" />
      <button disabled={loading} onClick={sendInvite} style={btn}>
        {loading ? 'Sending…' : 'Send SMS invite'}
      </button>
      {msg && <div style={{marginTop:12}}>{msg}</div>}
      <div style={{marginTop:16}}><a href="/dashboard">← Back to dashboard</a></div>
    </main>
  );
}
