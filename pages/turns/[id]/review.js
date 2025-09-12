// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Link from 'next/link';

function Badge({ status }) {
  const map = {
    in_progress: { bg: '#e2e8f0', fg: '#0f172a', label: 'In Progress' },
    submitted:   { bg: '#dbeafe', fg: '#1e3a8a', label: 'Submitted' },
    needs_fix:   { bg: '#fef3c7', fg: '#7c2d12', label: 'Needs Fix' },
    approved:    { bg: '#dcfce7', fg: '#065f46', label: 'Approved' },
    cancelled:   { bg: '#fee2e2', fg: '#7f1d1d', label: 'Cancelled' }
  };
  const s = map[status] || map.in_progress;
  return (
    <span style={{
      display:'inline-block', padding:'4px 8px', borderRadius:999,
      background:s.bg, color:s.fg, fontSize:12, fontWeight:700
    }}>
      {s.label}
    </span>
  );
}

export default function Review() {
  const router = useRouter();
  const turnId = router.query.id;

  const [loading, setLoading] = useState(true);
  const [turn, setTurn] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [err, setErr] = useState('');

  // Manager action bar state
  const [turnStatus, setTurnStatus] = useState(null);
  const [managerNote, setManagerNote] = useState('');
  const [acting, setActing] = useState(false);

  // load turn + photos
  useEffect(() => {
    if (!turnId) return;
    (async () => {
      try {
        setLoading(true);
        setErr('');

        // turn meta
        const rt = await fetch(`/api/get-turn?id=${turnId}`);
        const jt = await rt.json();
        if (!rt.ok) throw new Error(jt.error || 'Failed to load turn');
        setTurn(jt.turn);
        setTurnStatus(jt.turn.status);
        if (jt.turn.manager_notes) setManagerNote(jt.turn.manager_notes);

        // photos
        const rp = await fetch(`/api/list-turn-photos?id=${turnId}`);
        const jp = await rp.json();
        if (!rp.ok) throw new Error(jp.error || 'Failed to load photos');
        setPhotos(jp.photos || []);
      } catch (e) {
        setErr(e.message || 'Load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [turnId]);

  async function updateStatus(newStatus) {
    if (!turnId) return;
    setActing(true);
    try {
      const r = await fetch('/api/update-turn-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turn_id: turnId,
          new_status: newStatus,
          manager_note: managerNote || ''
        })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'Update failed');
      setTurnStatus(newStatus);
      alert(newStatus === 'approved' ? 'Turn approved ✅' : 'Marked Needs Fix 🛠️');
    } catch (e) {
      alert(e.message || 'Could not update status.');
    } finally {
      setActing(false);
    }
  }

  if (!turnId) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <div style={{ display:'flex', alignItems:'baseline', gap:12, flexWrap:'wrap' }}>
        <h1 style={{ margin:'0 0 4px' }}>Turn {turnId} — Review</h1>
        {turnStatus && <Badge status={turnStatus} />}
      </div>
      <div style={{ color:'#64748b', marginBottom:8 }}>
        <Link href="/managers/turns" style={{ color:'#0369a1', textDecoration:'none' }}>← Back to turns list</Link>
      </div>

      {/* ---- Manager Action Bar ---- */}
      <div style={{ margin:'12px 0 16px', padding:12, border:'1px solid #e5e7eb', borderRadius:12, background:'#fff' }}>
        <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
          <div style={{ fontWeight:700 }}>Status:</div>
          <Badge status={turnStatus || 'in_progress'} />
          {turn?.cleaner_name && <div style={{ color:'#475569' }}>Cleaner: <b>{turn.cleaner_name}</b></div>}
          {turn?.turn_date && <div style={{ color:'#475569' }}>Date: <b>{turn.turn_date}</b></div>}
        </div>

        <div style={{ marginTop:10 }}>
          <div style={{ fontSize:12, fontWeight:700, color:'#475569', marginBottom:6 }}>
            Optional note to cleaner (why needs fix / approval notes)
          </div>
          <textarea
            value={managerNote}
            onChange={e=>setManagerNote(e.target.value)}
            rows={3}
            placeholder="Short note the cleaner can see…"
            style={{ width:'100%', padding:'10px', border:'1px solid #cbd5e1', borderRadius:10, fontSize:14 }}
          />
        </div>

        <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
          <button
            onClick={()=>updateStatus('needs_fix')}
            disabled={acting}
            style={{ padding:'10px 12px', borderRadius:10, border:'1px solid #f59e0b', background:'#fffbeb', cursor:'pointer' }}
          >
            {acting ? '…' : '🛠️ Needs Fix'}
          </button>
          <button
            onClick={()=>{ if (confirm('Approve this turn?')) updateStatus('approved'); }}
            disabled={acting}
            style={{ padding:'10px 12px', borderRadius:10, border:'1px solid #22c55e', background:'#ecfdf5', cursor:'pointer' }}
          >
            {acting ? '…' : '✅ Approve'}
          </button>
        </div>
      </div>

      {/* Photos */}
      {err && <div style={{ color:'#b91c1c', marginBottom:8 }}>{err}</div>}
      {loading ? (
        <div>Loading photos…</div>
      ) : (
        <>
          <p style={{ marginTop: 8, color: '#555' }}>
            Click any photo to open full-size in a new tab.
          </p>
          {photos.length === 0 ? (
            <div>No photos yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, marginTop: 16 }}>
              {photos.map(p => (
                <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
                  <a href={p.signedUrl} target="_blank" rel="noreferrer">
                    <img src={p.signedUrl} alt={p.label || p.area_key || 'photo'} style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }} />
                  </a>
                  <div style={{ padding: 10, fontSize: 12 }}>
                    {p.label || p.area_key ? <div><b>{p.label || p.area_key}</b></div> : null}
                    {p.width && p.height ? <div>{p.width}×{p.height}</div> : null}
                    <div style={{ color: '#666' }}>{new Date(p.created_at).toLocaleString()}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
