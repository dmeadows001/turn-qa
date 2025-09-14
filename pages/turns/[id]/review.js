// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

async function fetchTurn(turnId) {
  const r = await fetch(`/api/get-turn?id=${turnId}`);
  if (!r.ok) throw new Error((await r.json()).error || 'get-turn failed');
  const j = await r.json();
  return j.turn;
}

async function fetchPhotos(turnId) {
  const r = await fetch(`/api/list-turn-photos?id=${turnId}`);
  if (!r.ok) throw new Error((await r.json()).error || 'list-turn-photos failed');
  const j = await r.json();
  return (j.photos || []).map(p => ({
    id: p.id,
    area_key: p.area_key || '',
    created_at: p.created_at,
    url: p.signedUrl || '',
    path: p.path || ''
  }));
}

function badgeStyle(status) {
  const map = {
    approved:  { bg:'#dcfce7', fg:'#166534' },
    submitted: { bg:'#dbeafe', fg:'#1e3a8a' },
    needs_fix: { bg:'#fef3c7', fg:'#92400e' },
    in_progress:{ bg:'#e2e8f0', fg:'#334155' }
  };
  const c = map[status] || { bg:'#f1f5f9', fg:'#334155' };
  return { background:c.bg, color:c.fg, padding:'2px 8px', borderRadius:999, fontSize:12, fontWeight:700 };
}

export default function Review() {
  const router = useRouter();
  const turnId = router.query.id;

  // Guard: show manager tools only when ?manager=1
  const isManagerMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('manager') === '1';

  const [turn, setTurn] = useState(null);
  const [status, setStatus] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');
  const [managerNote, setManagerNote] = useState('');
  const [acting, setActing] = useState(false);

  useEffect(() => {
    if (!turnId) return;
    (async () => {
      setLoading(true);
      setLoadErr('');
      try {
        const t = await fetchTurn(turnId);
        setTurn(t);
        setStatus(t?.status || 'in_progress');
        setManagerNote(t?.manager_notes || '');
        const ph = await fetchPhotos(turnId);
        setPhotos(ph);
      } catch (e) {
        setLoadErr(e.message || 'load failed');
      } finally {
        setLoading(false);
      }
    })();
  }, [turnId]);

  const uniqueAreas = useMemo(() => {
    const set = new Set((photos || []).map(p => p.area_key).filter(Boolean));
    return Array.from(set);
  }, [photos]);

  async function mark(newStatus) {
    if (!turnId) return;
    setActing(true);
    try {
      const r = await fetch('/api/update-turn-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_id: turnId, new_status: newStatus, manager_note: managerNote || '' })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'update failed');
      setStatus(newStatus);
      alert(newStatus === 'approved' ? 'Turn approved ✅' : 'Marked Needs Fix. Cleaners will see this.');
    } catch (e) {
      alert(e.message || 'Could not update status.');
    } finally {
      setActing(false);
    }
  }

  if (!turnId) return <div style={{ padding:24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <a href="/admin/turns" style={{ color:'#0369a1' }}>← Back to turns list</a>
      <h1 style={{ marginTop:10 }}>
        Turn {turnId} — Review
        <span style={{ marginLeft:10, verticalAlign:'middle' }}>
          <span style={badgeStyle(status)}>{(status || '—').replace('_',' ')}</span>
        </span>
      </h1>

      {/* Notice if not in manager mode */}
      {!isManagerMode && (
        <div style={{ marginTop: 8, padding: '8px 10px', background:'#f1f5f9', border:'1px solid #e2e8f0', borderRadius:10, color:'#334155', fontSize:13 }}>
          Read-only view. Manager controls hidden.
        </div>
      )}

      {/* ---- Manager Action Bar (hidden unless ?manager=1) ---- */}
      {isManagerMode && (
        <div style={{ margin:'12px 0 16px', padding:12, border:'1px solid #e5e7eb', borderRadius:12, background:'#fff' }}>
          <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
            <div style={{ fontWeight:700 }}>Status:</div>
            <span style={badgeStyle(status)}>{status || '—'}</span>
            {loadErr && <span style={{ color:'#b91c1c' }}>({loadErr})</span>}
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
              onClick={() => mark('needs_fix')}
              disabled={acting || !turnId}
              style={{ padding:'10px 12px', borderRadius:10, border:'1px solid #f59e0b', background:'#fffbeb', cursor:'pointer' }}
            >
              {acting ? '…' : '🛠️ Needs Fix'}
            </button>

            <button
              onClick={() => { const ok = window.confirm('Approve this turn?'); if (ok) mark('approved'); }}
              disabled={acting || !turnId}
              style={{ padding:'10px 12px', borderRadius:10, border:'1px solid #22c55e', background:'#ecfdf5', cursor:'pointer' }}
            >
              {acting ? '…' : '✅ Approve'}
            </button>
          </div>
        </div>
      )}

      <p style={{ marginTop: 12, color: '#555' }}>Click any photo to open full-size in a new tab.</p>

      {loading ? (
        <div>Loading photos…</div>
      ) : photos.length === 0 ? (
        <div>No photos yet.</div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, marginTop: 16 }}>
          {photos.map(p => (
            <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
              <a href={p.url} target="_blank" rel="noreferrer">
                <img
                  src={p.url}
                  alt={p.area_key || 'photo'}
                  style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }}
                />
              </a>
              <div style={{ padding: 10, fontSize: 12 }}>
                <div><b>{p.area_key || '—'}</b></div>
                <div style={{ color: '#666' }}>{new Date(p.created_at).toLocaleString()}</div>
                <div style={{ color: '#94a3b8' }}>{p.path}</div>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
