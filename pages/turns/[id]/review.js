import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

// Small helper to fetch photos (and signed URLs)
async function fetchPhotos(turnId) {
  const resp = await fetch(`/api/turn-photos?turnId=${turnId}`);
  if (!resp.ok) throw new Error('Failed to load photos');
  const json = await resp.json();
  return json.photos || [];
}

// Small helper to fetch current turn status
async function fetchTurnStatus(turnId) {
  const resp = await fetch(`/api/turn-status?turnId=${turnId}`);
  if (!resp.ok) return { status: 'unknown' };
  return await resp.json(); // { status: 'submitted' | 'approved' | 'needs_fix' | ... }
}

export default function Review() {
  const { query } = useRouter();
  const turnId = query.id;

  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('loading');

  // Finding form state (used only for Needs Fix)
  const [findingArea, setFindingArea] = useState('');
  const [findingLabel, setFindingLabel] = useState('');
  const [findingSeverity, setFindingSeverity] = useState('warn');
  const [findingNote, setFindingNote] = useState('');

  const uniqueAreas = useMemo(() => {
    const s = new Set(photos.map(p => p.area_key).filter(Boolean));
    return Array.from(s);
  }, [photos]);

  async function load() {
    if (!turnId) return;
    setLoading(true);
    const [ph, st] = await Promise.all([
      fetchPhotos(turnId),
      fetchTurnStatus(turnId)
    ]);
    setPhotos(ph);
    setStatus(st.status || 'unknown');
    setLoading(false);
  }

  useEffect(() => { load(); }, [turnId]);

  async function mark(statusToSet, withFinding = false) {
    const payload = { turnId, status: statusToSet };
    if (withFinding) {
      payload.finding = {
        area_key: findingArea || null,
        label: findingLabel || 'Needs fixes',
        severity: findingSeverity || 'warn',
        note: findingNote || null,
        evidence_url: null // (optional) could attach a specific photo path later
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

    // Refresh current status
    const st = await fetchTurnStatus(turnId);
    setStatus(st.status || statusToSet);
    if (withFinding) {
      // Reset form
      setFindingArea('');
      setFindingLabel('');
      setFindingSeverity('warn');
      setFindingNote('');
    }
    alert(`Turn marked: ${statusToSet.toUpperCase()}`);
  }

  if (!turnId) return <div style={{ padding:24 }}>Loading…</div>;

export default function Review() {
  const { query } = useRouter();
  const turnId = query.id;

  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState('loading');

  // Add badgeStyle helper here
  const badgeStyle = s => ({
    display:'inline-block',
    padding:'2px 8px',
    borderRadius:8,
    background: s==='approved'
      ? '#E6FFEA'
      : s==='needs_fix'
        ? '#FFF4E5'
        : '#EEF2FF',
    color: s==='approved'
      ? '#0F7B2D'
      : s==='needs_fix'
        ? '#9A5B00'
        : '#334155'
  });

  // ...rest of your helper functions (mark, load, etc.)

  if (!turnId) return <div style={{ padding:24 }}>Loading…</div>;

  return (
    <div>
      {/* page JSX */}
    </div>
  );
}

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {turnId} — Review</h1>

      <div style={{ margin:'8px 0' }}>
  <b>Status: </b>
  <span style={badgeStyle(status)}>{status}</span>
</div>

      {/* Action bar */}
      <div style={{ display:'flex', gap:12, alignItems:'center', flexWrap:'wrap', marginTop: 8, padding: 12, border:'1px solid #eee', borderRadius:12 }}>
        <button
  onClick={() => mark('approved')}
  disabled={status==='approved'}
  style={{ padding:'8px 12px', opacity: status==='approved' ? 0.5 : 1 }}
>
  ✅ Mark PASS
</button>

        <div style={{ fontSize:12, color:'#666' }}>or mark Needs Fix (optionally add a finding):</div>

        <select value={findingArea} onChange={e => setFindingArea(e.target.value)} style={{ padding:6 }}>
          <option value="">Select area (optional)</option>
          {uniqueAreas.map(a => <option key={a} value={a}>{a}</option>)}
        </select>

        <input
          placeholder="Finding label (e.g., Towel left on shower ledge)"
          value={findingLabel}
          onChange={e => setFindingLabel(e.target.value)}
          style={{ padding:6, minWidth: 280 }}
        />

        <select value={findingSeverity} onChange={e => setFindingSeverity(e.target.value)} style={{ padding:6 }}>
          <option value="info">info</option>
          <option value="warn">warn</option>
          <option value="fail">fail</option>
        </select>

        <input
          placeholder="Note (optional)"
          value={findingNote}
          onChange={e => setFindingNote(e.target.value)}
          style={{ padding:6, minWidth: 220 }}
        />

        <button
  onClick={() => mark('needs_fix', true)}
  disabled={status==='approved'}
  style={{ padding:'8px 12px', opacity: status==='approved' ? 0.5 : 1 }}
>
  ⚠️ Mark NEEDS FIX + Save Finding
</button>
      </div>

      {/* Photos grid */}
      <p style={{ marginTop: 12, color:'#555' }}>Click any photo to open full-size in a new tab.</p>

      {loading ? <div>Loading photos…</div> : (
        photos.length === 0 ? <div>No photos yet.</div> : (
          <div style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))',
            gap: 12, marginTop: 16
          }}>
            {photos.map(p => (
              <div key={p.id} style={{ border:'1px solid #eee', borderRadius:12, overflow:'hidden' }}>
                <a href={p.signedUrl} target="_blank" rel="noreferrer">
                  <img src={p.signedUrl} style={{ width:'100%', display:'block', aspectRatio:'4/3', objectFit:'cover' }} />
                </a>
                <div style={{ padding:10, fontSize:12 }}>
                  <div><b>{p.area_key}</b></div>
                  <div>{p.width}×{p.height}</div>
                  <div style={{ color:'#666' }}>{new Date(p.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
