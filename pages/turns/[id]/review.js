// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  const map = {
    approved:   { bg:'#064e3b', fg:'#86efac', bd:'#065f46' },
    submitted:  { bg:'#0b3b72', fg:'#93c5fd', bd:'#1d4ed8' },
    needs_fix:  { bg:'#4a2f04', fg:'#fcd34d', bd:'#d97706' },
    in_progress:{ bg:'#1f2937', fg:'#cbd5e1', bd:'#334155' }
  };
  const c = map[status] || { bg:'#1f2937', fg:'#cbd5e1', bd:'#334155' };
  return {
    background: c.bg, color: c.fg, border: `1px solid ${c.bd}`,
    padding:'2px 8px', borderRadius: 999, fontSize:12, fontWeight:700, display:'inline-block'
  };
}

// simple uploader like capture.js uses
async function getDims(file) {
  return await new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
    img.onerror = reject;
    img.src = URL.createObjectURL(file);
  });
}

export default function Review() {
  const router = useRouter();
  const turnId = router.query.id;

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

  // cleaner-fix UI state
  const [reply, setReply] = useState('');
  const [newArea, setNewArea] = useState('');
  const [staged, setStaged] = useState([]); // [{name, path, width, height}]
  const [uploading, setUploading] = useState(false);
  const fileInputRef = useRef(null);

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
        setReply(''); // fresh each load
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
    const arr = Array.from(set);
    return arr.length ? arr : ['general'];
  }, [photos]);

  useEffect(() => {
    if (!newArea && uniqueAreas.length) setNewArea(uniqueAreas[0]);
  }, [uniqueAreas, newArea]);

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

  async function addFiles(fileList) {
    const files = Array.from(fileList || []);
    if (!files.length) return;
    setUploading(true);
    try {
      const uploaded = [];
      for (const f of files) {
        const dims = await getDims(f);
        const longest = Math.max(dims.width, dims.height);
        if (longest < 1024) { alert(`"${f.name}" rejected: edge < 1024px`); continue; }
        if (f.size > 6 * 1024 * 1024) { alert(`"${f.name}" rejected: >6MB`); continue; }

        const up = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ turnId, shotId: `${newArea || 'general'}-fix`, filename: f.name, mime: f.type })
        }).then(r => r.json());

        if (!up.uploadUrl || !up.path) { alert('Could not get upload URL; try again.'); continue; }

        await fetch(up.uploadUrl, { method:'PUT', headers:{ 'Content-Type': up.mime || 'application/octet-stream' }, body: f });

        uploaded.push({ name: f.name, path: up.path, width: dims.width, height: dims.height });
      }
      if (uploaded.length) setStaged(prev => [...prev, ...uploaded]);
    } finally {
      setUploading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  }

  async function resubmit() {
    if (!turnId) return;
    try {
      const payload = {
        turn_id: turnId,
        reply: reply || '',
        photos: staged.map(s => ({ path: s.path, area_key: newArea || null }))
      };
      const r = await fetch('/api/resubmit-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'resubmit failed');
      alert('Re-submitted for approval. Your manager will be notified.');
      setStaged([]);
      setReply('');
      // refresh turn + photos + status
      const t = await fetchTurn(turnId);
      setTurn(t);
      setStatus(t?.status || 'submitted');
      const ph = await fetchPhotos(turnId);
      setPhotos(ph);
    } catch (e) {
      alert(e.message || 'Could not re-submit.');
    }
  }

  if (!turnId) {
    return (
      <ChromeDark title="Turn Review">
        <section style={ui.sectionGrid}><div style={ui.card}>Loading…</div></section>
      </ChromeDark>
    );
  }

  const showCleanerFixPanel = !isManagerMode && (status === 'needs_fix' || status === 'in_progress');

  return (
    <ChromeDark title="Turn Review">
      <section style={ui.sectionGrid}>
        {/* Header / Meta */}
        <div style={ui.card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <a
              href={isManagerMode ? '/managers/turns' : '/cleaner/turns'}
              style={{ ...ui.btnSecondary, textDecoration:'none' }}
            >
              ← Back to {isManagerMode ? 'turns' : 'my turns'}
            </a>
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

          {/* Manager note visibility for cleaners */}
          {!isManagerMode && turn?.manager_notes && (
            <div style={{
              marginTop: 8, padding: '10px 12px',
              background:'#0b1220', border:'1px solid #334155', borderRadius:10,
              color:'#cbd5e1', fontSize:14
            }}>
              <div style={{ fontWeight:700, marginBottom:4 }}>Manager note</div>
              <div>{turn.manager_notes}</div>
            </div>
          )}

          {/* Manager-only action bar */}
          {isManagerMode && (
            <div style={{ margin:'12px 0 6px', padding:12, border:'1px solid #334155', borderRadius:12, background:'#0f172a' }}>
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
                  style={{ ...ui.input, width:'100%', padding:'10px 12px', resize:'vertical', background:'#0b1220' }}
                />
              </div>

              <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
                <button
                  onClick={() => mark('needs_fix')}
                  disabled={acting || !turnId}
                  style={{ ...ui.btnSecondary, border:'1px solid #d97706', background:'#4a2f04', color:'#fcd34d' }}
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

          {/* Cleaner Fix & Resubmit panel */}
          {showCleanerFixPanel && (
            <div style={{ marginTop:12, padding:12, border:'1px dashed #334155', borderRadius:12, background:'#0f172a' }}>
              <div style={{ fontWeight:700, marginBottom:8 }}>Fix items and re-submit</div>
              <div style={{ display:'grid', gridTemplateColumns:'1fr 160px', gap:10 }}>
                <input
                  value={reply}
                  onChange={e=>setReply(e.target.value)}
                  placeholder="Short note back to your manager (optional)…"
                  style={ui.input}
                />
                <select value={newArea} onChange={e=>setNewArea(e.target.value)} style={{ ...ui.input, cursor:'pointer' }}>
                  {uniqueAreas.map(a => <option key={a} value={a}>{a}</option>)}
                </select>
              </div>

              <div style={{ marginTop:10, display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  onChange={(e)=>addFiles(e.target.files)}
                  style={{ display:'none' }}
                />
                <button
                  onClick={()=>fileInputRef.current?.click()}
                  disabled={uploading}
                  style={ui.btnSecondary}
                >
                  {uploading ? 'Uploading…' : '➕ Add photo(s)'}
                </button>

                <button
                  onClick={resubmit}
                  disabled={uploading || (!reply && staged.length === 0)}
                  style={ui.btnPrimary}
                >
                  Submit fixes for review
                </button>
              </div>

              {staged.length > 0 && (
                <div style={{ marginTop:10, color:'#cbd5e1', fontSize:13 }}>
                  Staged: {staged.map(s => s.name).join(', ')}
                </div>
              )}

              <div style={{ ...ui.subtle, marginTop:8 }}>
                Tip: choose the checklist area first, then add photos for that area.
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

        {useMemo(() => {
          const set = new Set((photos || []).map(p => p.area_key).filter(Boolean));
          const arr = Array.from(set);
          return (arr.length > 1) ? (
            <div style={{ ...ui.subtle }}>Areas in this turn: {arr.join(' • ')}</div>
          ) : null;
        }, [photos])}
      </section>
    </ChromeDark>
  );
}
