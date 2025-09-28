// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

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
  // Dark-theme friendly badges
  const map = {
    approved:   { bg:'#064e3b', fg:'#86efac', bd:'#065f46' },  // green
    submitted:  { bg:'#0b3b72', fg:'#93c5fd', bd:'#1d4ed8' },  // blue
    needs_fix:  { bg:'#4a2f04', fg:'#fcd34d', bd:'#d97706' },  // amber
    in_progress:{ bg:'#1f2937', fg:'#cbd5e1', bd:'#334155' }   // slate
  };
  const c = map[status] || { bg:'#1f2937', fg:'#cbd5e1', bd:'#334155' };
  return {
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.bd}`,
    padding:'2px 8px',
    borderRadius: 999,
    fontSize:12,
    fontWeight:700,
    display:'inline-block'
  };
}

export default function Review() {
  const router = useRouter();
  const turnId = router.query.id;

  // Determine context from query
  const isBrowser = typeof window !== 'undefined';
  const qs = isBrowser ? new URLSearchParams(window.location.search) : null;
  const isManagerMode = qs?.get('manager') === '1';
  const from = qs?.get('from') || '';           // optional, e.g. 'cleaner'
  const phone = qs?.get('phone') || '';         // optional, so we can prefill back link

  // Compute back link target + label
  const backHref = isManagerMode
    ? '/managers/turns'
    : (phone ? `/cleaner/turns?phone=${encodeURIComponent(phone)}` : '/cleaner/turns');
  const backLabel = isManagerMode ? '← Back to turns' : '← Back to my turns';

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

  if (!turnId) {
    return (
      <ChromeDark title="Turn Review">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  return (
    <ChromeDark title="Turn Review">
      <section style={ui.sectionGrid}>
        {/* Header / Meta */}
        <div style={ui.card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <a href={backHref} style={{ ...ui.btnSecondary, textDecoration:'none' }}>{backLabel}</a>
            <div style={{ fontSize:12, color:'#94a3b8' }}>
              Turn ID: <code style={{ userSelect:'all' }}>{turnId}</code>
            </div>
          </div>

          <h2 style={{ marginTop: 12, marginBottom: 6 }}>
            Review Photos
            <span style={{ marginLeft:10, verticalAlign:'middle' }}>
              <span style={badgeStyle(status)}>{(status || '—').replace('_',' ')}</span>
            </span>
          </h2>

          {/* Notice if not in manager mode */}
          {!isManagerMode && (
            <div style={{
              marginTop: 8, padding: '8px 10px',
              background:'#0b1220', border:'1px solid #334155', borderRadius:10,
              color:'#cbd5e1', fontSize:13
            }}>
              Read-only view. Manager controls hidden.
            </div>
          )}

          {/* ---- Manager Action Bar (hidden unless ?manager=1) ---- */}
          {isManagerMode && (
            <div style={{
              margin:'12px 0 6px',
              padding:12,
              border:'1px solid #334155',
              borderRadius:12,
              background:'#0f172a'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <div style={{ fontWeight:700 }}>Status:</div>
                <span style={badgeStyle(status)}>{status || '—'}</span>
                {loadErr && <span style={{ color:'#fca5a5' }}>({loadErr})</span>}
              </div>

              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#9ca3af', marginBottom:6 }}>
                  Optional note to cleaner (why needs fix / approval notes)
                </div>
                <textarea
                  value={managerNote}
                  onChange={e=>setManagerNote(e.target.value)}
                  rows={3}
                  placeholder="Short note the cleaner can see…"
                  style={{
                    ...ui.input,
                    width:'100%',
                    padding:'10px 12px',
                    resize:'vertical',
                    background:'#0b1220'
                  }}
                />
              </div>

              <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
                <button
                  onClick={() => mark('needs_fix')}
                  disabled={acting || !turnId}
                  style={{
                    ...ui.btnSecondary,
                    border:'1px solid #d97706',
                    background:'#4a2f04',
                    color:'#fcd34d'
                  }}
                >
                  {acting ? '…' : '🛠️ Needs Fix'}
                </button>

                <button
                  onClick={() => { const ok = window.confirm('Approve this turn?'); if (ok) mark('approved'); }}
                  disabled={acting || !turnId}
                  style={ui.btnPrimary}
                >
                  {acting ? '…' : '✅ Approve'}
                </button>
              </div>
            </div>
          )}

          <div style={{ ...ui.subtle, marginTop: 10 }}>
            Click any photo to open full-size in a new tab.
          </div>
        </div>

        {/* Photos */}
        <div style={ui.card}>
          {loading ? (
            <div>Loading photos…</div>
          ) : photos.length === 0 ? (
            <div style={ui.muted}>No photos yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, marginTop: 4 }}>
              {photos.map(p => (
                <div key={p.id} style={{ border: '1px solid #334155', borderRadius: 12, overflow: 'hidden', background:'#0b1220' }}>
                  <a href={p.url} target="_blank" rel="noreferrer">
                    <img
                      src={p.url}
                      alt={p.area_key || 'photo'}
                      style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }}
                    />
                  </a>
                  <div style={{ padding: 10, fontSize: 12 }}>
                    <div><b>{p.area_key || '—'}</b></div>
                    <div style={{ color: '#9ca3af' }}>{new Date(p.created_at).toLocaleString()}</div>
                    <div style={{ color: '#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.path}</div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* (Optional) Area quick filter in future */}
        {uniqueAreas.length > 1 && (
          <div style={{ ...ui.subtle }}>
            Areas in this turn: {uniqueAreas.join(' • ')}
          </div>
        )}
      </section>
    </ChromeDark>
  );
}
