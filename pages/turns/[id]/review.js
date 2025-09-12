// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';
import { useEffect, useState } from 'react';

// --- helpers to load data ---
async function fetchPhotos(turnId) {
  const resp = await fetch(`/api/turn-photos?turnId=${turnId}`);
  if (!resp.ok) throw new Error('Failed to load photos');
  const json = await resp.json();
  return json.photos || [];
}

async function fetchTurnStatus(turnId) {
  const resp = await fetch(`/api/turn-status?turnId=${turnId}`);
  if (!resp.ok) return { status: 'unknown' };
  return await resp.json(); // { status: 'submitted' | 'approved' | 'needs_fix' | ... }
}

export default function Review() {
  const { query } = useRouter();
  const turnId = query.id;
  const router = useRouter();
  const turnId = router.query.id;

  const [turnStatus, setTurnStatus] = useState(null);
  const [managerNote, setManagerNote] = useState('');
  const [acting, setActing] = useState(false);
  const [loadErr, setLoadErr] = useState('');

  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('loading');

  // Finding form (for Needs Fix)
  const [findingArea, setFindingArea] = useState('');
  const [findingLabel, setFindingLabel] = useState('');
  const [findingSeverity, setFindingSeverity] = useState('warn');
  const [findingNote, setFindingNote] = useState('');

  // status badge styles
  const badgeStyle = s => ({
    display: 'inline-block',
    padding: '2px 8px',
    borderRadius: 8,
    background: s === 'approved' ? '#E6FFEA' : s === 'needs_fix' ? '#FFF4E5' : '#EEF2FF',
    color: s === 'approved' ? '#0F7B2D' : s === 'needs_fix' ? '#9A5B00' : '#334155'
  });

  const uniqueAreas = useMemo(() => {
    const s = new Set(photos.map(p => p.area_key).filter(Boolean));
    return Array.from(s);
  }, [photos]);

  async function load() {
    if (!turnId) return;
    setLoading(true);
    const [ph, st] = await Promise.all([fetchPhotos(turnId), fetchTurnStatus(turnId)]);
    setPhotos(ph);
    setStatus(st.status || 'unknown');
    setLoading(false);
  }

  useEffect(() => { load(); }, [turnId]);

  useEffect(() => {
  if (!turnId) return;
  (async () => {
    try {
      setLoadErr('');
      const r = await fetch(`/api/get-turn?id=${turnId}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'failed to load turn');
      setTurnStatus(j.turn.status);
      // Seed the note with any prior manager note if you want
      if (j.turn.manager_notes) setManagerNote(j.turn.manager_notes);
    } catch (e) {
      setLoadErr(e.message || 'Could not load turn.');
    }
  })();
}, [turnId]);


  async function mark(statusToSet, withFinding = false) {
    const payload = { turnId, status: statusToSet };
    if (withFinding) {
      payload.finding = {
        area_key: findingArea || null,
        label: findingLabel || 'Needs fixes',
        severity: findingSeverity || 'warn',
        note: findingNote || null,
        evidence_url: null
      };
    }

    const resp = await fetch('/api/mark-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert('Failed to update status: ' + (err.error || resp.statusText));
      return;
    }

    // refresh status
    const st = await fetchTurnStatus(turnId);
    setStatus(st.status || statusToSet);

    // reset finding form
    if (withFinding) {
      setFindingArea('');
      setFindingLabel('');
      setFindingSeverity('warn');
      setFindingNote('');
    }

    alert(`Turn marked: ${statusToSet.toUpperCase()}`);
  }

  async function markNeedsFix() {
    if (!findingLabel.trim()) {
      alert('Add a short finding label (e.g., "Towel left on shower ledge")');
      return;
    }
    await mark('needs_fix', true);
  }

  if (!turnId) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {turnId} — Review</h1>

    {/* ---- Manager Action Bar ---- */}
<div style={{ 
  margin:'12px 0 16px', padding:12, border:'1px solid #e5e7eb', borderRadius:12, background:'#fff'
}}>
  <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
    <div style={{ fontWeight:700 }}>Status:</div>
    <span style={{
      display:'inline-block', padding:'4px 8px', borderRadius:999,
      background: turnStatus === 'approved' ? '#dcfce7'
        : turnStatus === 'submitted' ? '#dbeafe'
        : turnStatus === 'needs_fix' ? '#fef3c7'
        : turnStatus === 'cancelled' ? '#fee2e2'
        : '#e2e8f0',
      color:'#0f172a', fontSize:12, fontWeight:700
    }}>
      {turnStatus || '—'}
    </span>
    {loadErr && <span style={{ color:'#b91c1c' }}>({loadErr})</span>}
  </div>

  <div style={{ marginTop:10 }}>
    <div style={{ fontSize:12, fontWeight:700, color:'#475569', marginBottom:6 }}>
      Optional note to cleaner (why needs fix or approval notes)
    </div>
    <textarea
      value={managerNote}
      onChange={e=>setManagerNote(e.target.value)}
      rows={3}
      placeholder="Short note that cleaners can see…"
      style={{ width:'100%', padding:'10px', border:'1px solid #cbd5e1', borderRadius:10, fontSize:14 }}
    />
  </div>

  <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
    <button
      onClick={async ()=>{
        if (!turnId) return;
        const note = managerNote || '';
        setActing(true);
        try {
          const r = await fetch('/api/update-turn-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turn_id: turnId, new_status: 'needs_fix', manager_note: note })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'update failed');
          setTurnStatus('needs_fix');
          alert('Marked Needs Fix. Cleaner will see this on their next visit.');
        } catch (e) {
          alert(e.message || 'Could not update status.');
        } finally {
          setActing(false);
        }
      }}
      disabled={acting || !turnId}
      style={{ padding:'10px 12px', borderRadius:10, border:'1px solid #f59e0b', background:'#fffbeb', cursor:'pointer' }}
    >
      {acting ? '…' : '🛠️ Needs Fix'}
    </button>

    <button
      onClick={async ()=>{
        if (!turnId) return;
        const ok = window.confirm('Approve this turn?');
        if (!ok) return;
        const note = managerNote || '';
        setActing(true);
        try {
          const r = await fetch('/api/update-turn-status', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ turn_id: turnId, new_status: 'approved', manager_note: note })
          });
          const j = await r.json();
          if (!r.ok) throw new Error(j.error || 'update failed');
          setTurnStatus('approved');
          alert('Turn approved ✅');
        } catch (e) {
          alert(e.message || 'Could not update status.');
        } finally {
          setActing(false);
        }
      }}
      disabled={acting || !turnId}
      style={{ padding:'10px 12px', borderRadius:10, border:'1px solid #22c55e', background:'#ecfdf5', cursor:'pointer' }}
    >
      {acting ? '…' : '✅ Approve'}
    </button>
  </div>
</div>


      <div style={{ margin: '8px 0' }}>
        <b>Status: </b>
        <span style={badgeStyle(status)}>{status}</span>
      </div>

      {/* Action bar */}
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap', marginTop: 8, padding: 12, border: '1px solid #eee', borderRadius: 12 }}>
        <button
          onClick={() => mark('approved')}
          disabled={status === 'approved'}
          style={{ padding: '8px 12px', opacity: status === 'approved' ? 0.5 : 1 }}
        >
          ✅ Mark PASS
        </button>

        <div style={{ fontSize: 12, color: '#666' }}>or mark Needs Fix (add a finding):</div>

        <select value={findingArea} onChange={e => setFindingArea(e.target.value)} style={{ padding: 6 }}>
          <option value="">Select area (optional)</option>
          {uniqueAreas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <input
          placeholder="Finding label (e.g., Towel left on shower ledge)"
          value={findingLabel}
          onChange={e => setFindingLabel(e.target.value)}
          style={{ padding: 6, minWidth: 280 }}
        />

        <select value={findingSeverity} onChange={e => setFindingSeverity(e.target.value)} style={{ padding: 6 }}>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="fail">fail</option>
        </select>

        <input
          placeholder="Note (optional)"
          value={findingNote}
          onChange={e => setFindingNote(e.target.value)}
          style={{ padding: 6, minWidth: 220 }}
        />

        <button
          onClick={markNeedsFix}
          disabled={status === 'approved'}
          style={{ padding: '8px 12px', opacity: status === 'approved' ? 0.5 : 1 }}
        >
          ⚠️ Mark NEEDS FIX + Save Finding
        </button>
      </div>

      <p style={{ marginTop: 12, color: '#555' }}>Click any photo to open full-size in a new tab.</p>

      {loading ? <div>Loading photos…</div> : (
        photos.length === 0 ? <div>No photos yet.</div> : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, marginTop: 16 }}>
            {photos.map(p => (
              <div key={p.id} style={{ border: '1px solid #eee', borderRadius: 12, overflow: 'hidden' }}>
                <a href={p.signedUrl} target="_blank" rel="noreferrer">
                  <img src={p.signedUrl} style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }} />
                </a>
                <div style={{ padding: 10, fontSize: 12 }}>
                  <div><b>{p.area_key}</b></div>
                  <div>{p.width}×{p.height}</div>
                  <div style={{ color: '#666' }}>{new Date(p.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
