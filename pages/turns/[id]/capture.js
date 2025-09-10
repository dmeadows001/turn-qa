// pages/turns/[id]/capture.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

// Fallback default shots if no template is linked to this turn
const DEFAULT_SHOTS = [
  { key: 'entry_overall',       label: 'Entry - Overall',           minCount: 1 },
  { key: 'living_overall',      label: 'Living - Overall',          minCount: 1 },
  { key: 'living_under_tables', label: 'Living - Under Tables',     minCount: 1 },
  { key: 'kitchen_overall',     label: 'Kitchen - Overall',         minCount: 2 },
  { key: 'bathroom_overall',    label: 'Bathroom - Overall',        minCount: 2 },
  { key: 'bedroom_overall',     label: 'Bedroom - Overall',         minCount: 1 }
];

export default function Capture() {
  const { query } = useRouter();
  const turnId = query.id;

  // -------- State --------
  // Shots required for THIS turn (loaded from /api/turn-template). null = loading
  const [requiredShots, setRequiredShots] = useState(null);

  // Uploaded files grouped by area: { [areaKey]: [{name,url,width,height,areaKey}, ...] }
  const [uploadsByArea, setUploadsByArea] = useState({});
  // Combined findings list (rules + AI)
  const [aiFlags, setAiFlags] = useState([]);
  // Per-photo AI flags map: { [storagePath]: issues[] }
  const [aiByPath, setAiByPath] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // --- Lightbox state ---
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);   // signed URL
  const [lightboxPath, setLightboxPath] = useState(null); // storage path
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // -------- Helpers / UI bits --------
  const sevStyle = (s='info') => ({
    display:'inline-block',
    padding:'2px 6px',
    borderRadius:8,
    fontSize:12,
    marginRight:6,
    background: s==='fail' ? '#FEE2E2' : s==='warn' ? '#FFF4E5' : '#EEF2FF',
    color: s==='fail' ? '#991B1B' : s==='warn' ? '#9A5B00' : '#334155'
  });

  async function getDims(file) {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => { resolve({ width: img.naturalWidth, height: img.naturalHeight }); URL.revokeObjectURL(img.src); };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  async function signPath(path) {
    const resp = await fetch('/api/sign-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, expires: 600 }) // 10 min
    });
    if (!resp.ok) throw new Error('sign failed');
    const json = await resp.json();
    return json.url;
  }

  async function viewPhoto(path) {
    try {
      const url = await signPath(path);
      setLightboxPath(path);
      setLightboxUrl(url);
      setZoom(1);
      setRotation(0);
      setLightboxOpen(true);
    } catch { alert('Could not open photo. Try again.'); }
  }
  function closeLightbox(){ setLightboxOpen(false); setLightboxUrl(null); setLightboxPath(null); }
  function zoomIn(){ setZoom(z => Math.min(z + 0.25, 3)); }
  function zoomOut(){ setZoom(z => Math.max(z - 0.25, 0.5)); }
  function rotateLeft(){ setRotation(r => (r - 90 + 360) % 360); }
  function rotateRight(){ setRotation(r => (r + 90) % 360); }
  async function refreshSignedUrl(){ if (!lightboxPath) return; try { setLightboxUrl(await signPath(lightboxPath)); } catch {} }
  function downloadCurrent(){
    if (!lightboxUrl) return;
    const a = document.createElement('a');
    a.href = lightboxUrl;
    a.download = lightboxPath?.split('/').pop() || 'photo.jpg';
    document.body.appendChild(a); a.click(); a.remove();
  }

  // -------- Load required shots for this turn (template-aware) --------
  useEffect(() => {
    async function loadTemplate() {
      if (!turnId) return;
      try {
        const r = await fetch(`/api/turn-template?turnId=${turnId}`);
        const json = await r.json();
        if (Array.isArray(json.shots) && json.shots.length) {
          // Map API rows to UI shape
          setRequiredShots(json.shots.map(s => ({
            key: s.area_key,
            label: s.label,
            minCount: s.min_count || 1,
            notes: s.notes || ''
          })));
        } else {
          // No template linked → fallback defaults
          setRequiredShots(DEFAULT_SHOTS);
        }
      } catch {
        setRequiredShots(DEFAULT_SHOTS);
      }
    }
    loadTemplate();
  }, [turnId]);

  // -------- Add files (quality + upload to Storage) --------
  async function addFiles(areaKey, fileList) {
    const files = Array.from(fileList || []);
    const uploaded = [];

    for (const f of files) {
      const dims = await getDims(f);
      const longest = Math.max(dims.width, dims.height);
      const tooSmall = longest < 1024;
      const tooBig = f.size > 6 * 1024 * 1024; // >6MB

      if (tooSmall || tooBig) {
        alert(
          `Rejected "${f.name}": ` +
          (tooSmall ? `min longest side is 1024px (got ${dims.width}×${dims.height}). ` : '') +
          (tooBig ? `file > 6MB.` : '')
        );
        continue;
      }

      const up = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, areaKey, filename: f.name, mime: f.type })
      }).then(r => r.json());

      if (!up.uploadUrl || !up.path) {
        alert('Could not get upload URL; try again.');
        continue;
      }

      await fetch(up.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': up.mime || 'application/octet-stream' },
        body: f
      });

      uploaded.push({ name: f.name, areaKey, url: up.path, width: dims.width, height: dims.height });
    }

    if (uploaded.length) {
      setUploadsByArea(prev => ({ ...prev, [areaKey]: [ ...(prev[areaKey] || []), ...uploaded ] }));
    }
  }

  // -------- AI Pre-Check (rules + OpenAI vision) --------
  async function runPrecheck() {
    const localFlags = [];
    const MIN_LONGEST = 1024;

    Object.entries(uploadsByArea).forEach(([area, files]) => {
      files.forEach(f => {
        const longest = Math.max(f.width || 0, f.height || 0);
        if (longest && longest < MIN_LONGEST) {
          localFlags.push(`Low-resolution in ${area}: ${f.name} (${f.width}×${f.height})`);
        }
      });
    });

    const ruleResp = await fetch('/api/vision-precheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadsByArea })
    }).then(r => r.json()).catch(() => ({ flags: [] }));

    const aiResp = await fetch('/api/vision-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadsByArea })
    }).then(r => r.json()).catch(() => ({ results: [], error: 'network' }));

    const perPhoto = {};
    (aiResp.results || []).forEach(r => { perPhoto[r.path] = Array.isArray(r.issues) ? r.issues : []; });
    setAiByPath(perPhoto);

    const aiLines = [];
    (aiResp.results || []).forEach(r => {
      (r.issues || []).forEach(issue => {
        const sev = (issue.severity || 'info').toUpperCase();
        const conf = typeof issue.confidence === 'number' ? ` (${Math.round(issue.confidence * 100)}%)` : '';
        aiLines.push(`${sev} in ${r.area_key || 'unknown'}: ${issue.label}${conf}`);
      });
    });
    if (aiResp.error) aiLines.unshift(`AI check notice: ${aiResp.error}`);

    setAiFlags([ ...(ruleResp.flags || []), ...localFlags, ...aiLines ]);
  }

  // -------- Submit (enforce min counts from template) --------
  async function submitAll() {
    // Block submission if any required shot is missing photos
    const unmet = (requiredShots || []).filter(a => (a.minCount || 1) > (uploadsByArea[a.key]?.length || 0));
    if (unmet.length) {
      alert('Please add required photos before submitting:\n' + unmet.map(a => `• ${a.label}`).join('\n'));
      return;
    }

    setSubmitting(true);
    const photos = Object.values(uploadsByArea).flat();
    const resp = await fetch('/api/submit-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId, photos })
    });
    setSubmitting(false);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert('Submit failed: ' + (err.error || resp.statusText));
      return;
    }
    alert('Submitted! (MVP)');
  }

  // -------- Render --------
  if (!turnId || requiredShots === null) return <div style={{ padding:24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {turnId} — Cleaner Capture</h1>
      <p style={{ color:'#555' }}>
        Upload clear photos for each required shot. Longest side ≥ 1024px, ≤ 6MB. Run AI Pre-Check before submitting.
      </p>

      {requiredShots.map(area => {
        const files = uploadsByArea[area.key] || [];
        const missing = Math.max(0, (area.minCount || 1) - files.length);
        return (
          <div key={area.key} style={{ border:'1px solid #eee', borderRadius:12, padding:12, margin:'12px 0' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
              <div>
                <b>{area.label}</b>
                {area.notes ? <div style={{ fontSize:12, color:'#64748b' }}>{area.notes}</div> : null}
                <div style={{ fontSize:12, marginTop:4, color: missing>0 ? '#9A3412' : '#0F766E' }}>
                  Required: {area.minCount || 1} • Uploaded: {files.length} {missing>0 ? `• Missing: ${missing}` : '• ✅'}
                </div>
              </div>
              <input type="file" accept="image/*" multiple onChange={(e)=>addFiles(area.key, e.target.files)} />
            </div>

            {/* File cards */}
            {files.length > 0 && (
              <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16 }}>
                {files.map(f => (
                  <div key={f.url} style={{ border:'1px solid #eee', borderRadius:10, padding:10 }}>
                    <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                      <div style={{ fontSize:13, maxWidth:'70%' }}>
                        <b title={f.name}>{f.name}</b><br/>
                        {f.width}×{f.height}
                      </div>
                      <button onClick={() => viewPhoto(f.url)} style={{ padding:'6px 10px' }}>
                        👁️ View
                      </button>
                    </div>

                    {/* AI flags under each photo */}
                    {Array.isArray(aiByPath[f.url]) && aiByPath[f.url].length > 0 && (
                      <div>
                        {aiByPath[f.url].map((iss, idx) => (
                          <div key={idx} style={{ marginBottom:4 }}>
                            <span style={sevStyle(iss.severity)}>{(iss.severity || 'info').toUpperCase()}</span>
                            <span style={{ fontSize:13 }}>
                              {iss.label}
                              {typeof iss.confidence === 'number' ? ` (${Math.round(iss.confidence * 100)}%)` : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* AI findings summary */}
      <div style={{ border:'1px dashed #cbd5e1', borderRadius:12, padding:12, marginTop:16 }}>
        <div style={{ fontWeight:600, marginBottom:8 }}>AI Findings</div>
        {aiFlags.length === 0 ? (
          <div style={{ color:'#64748b' }}>No findings yet — click “Run AI Pre-Check”.</div>
        ) : (
          <ul style={{ marginLeft:18 }}>
            {aiFlags.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        )}
      </div>

      <div style={{ display:'flex', gap:12, marginTop:16 }}>
        <button onClick={runPrecheck} style={{ padding:'10px 14px' }}>
          🔎 Run AI Pre-Check
        </button>
        <button onClick={submitAll} disabled={submitting} style={{ padding:'10px 14px', opacity: submitting ? 0.6 : 1 }}>
          ✅ Submit Turn
        </button>
      </div>

      {/* --- LIGHTBOX MODAL --- */}
      {lightboxOpen && (
        <div
          onClick={(e) => { if (e.target === e.currentTarget) closeLightbox(); }}
          style={{
            position:'fixed', inset:0, background:'rgba(0,0,0,0.75)',
            display:'flex', alignItems:'center', justifyContent:'center', zIndex:1000, padding:16
          }}
        >
          <div style={{ position:'relative', width:'min(95vw,1100px)', maxHeight:'90vh', background:'#111', borderRadius:12, overflow:'hidden' }}>
            {/* Toolbar */}
            <div style={{ display:'flex', gap:8, padding:'8px 10px', alignItems:'center', background:'#0f172a', color:'#fff' }}>
              <button onClick={closeLightbox} style={{ padding:'6px 10px' }}>✖ Close (Esc)</button>
              <div style={{ flex:1 }} />
              <button onClick={zoomOut} style={{ padding:'6px 10px' }}>➖ Zoom</button>
              <button onClick={zoomIn} style={{ padding:'6px 10px' }}>➕ Zoom</button>
              <button onClick={rotateLeft} style={{ padding:'6px 10px' }}>⟲ Rotate</button>
              <button onClick={rotateRight} style={{ padding:'6px 10px' }}>⟳ Rotate</button>
              <button onClick={refreshSignedUrl} style={{ padding:'6px 10px' }}>⟳ Refresh URL</button>
              <button onClick={downloadCurrent} style={{ padding:'6px 10px' }}>⬇ Download</button>
            </div>

            {/* Image */}
            <div style={{ display:'flex', alignItems:'center', justifyContent:'center', padding:16, maxHeight:'calc(90vh - 48px)', overflow:'auto' }}>
              {lightboxUrl ? (
                <img
                  src={lightboxUrl}
                  alt="Photo"
                  style={{
                    maxWidth:'100%',
                    maxHeight:'80vh',
                    transform: `scale(${zoom}) rotate(${rotation}deg)`,
                    transformOrigin:'center center',
                    transition:'transform 120ms ease'
                  }}
                  draggable={false}
                />
              ) : (
                <div style={{ color:'#e2e8f0' }}>Loading…</div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
