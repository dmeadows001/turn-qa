// pages/turns/[id]/capture.js
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

// Fallback default shots if no template is linked to this turn
const DEFAULT_SHOTS = [
  { shot_id: 'fallback-entry_overall',  area_key: 'entry_overall',       label: 'Entry - Overall',           min_count: 1 },
  { shot_id: 'fallback-living_overall', area_key: 'living_overall',      label: 'Living - Overall',          min_count: 1 },
  { shot_id: 'fallback-living_under',   area_key: 'living_under_tables', label: 'Living - Under Tables',     min_count: 1 },
  { shot_id: 'fallback-kitchen',        area_key: 'kitchen_overall',     label: 'Kitchen - Overall',         min_count: 2 },
  { shot_id: 'fallback-bathroom',       area_key: 'bathroom_overall',    label: 'Bathroom - Overall',        min_count: 2 },
  { shot_id: 'fallback-bedroom',        area_key: 'bedroom_overall',     label: 'Bedroom - Overall',         min_count: 1 }
];

// Re-usable button variants that honor theme.js
function ThemedButton({ children, onClick, disabled=false, loading=false, kind='primary', full=false, ariaLabel }) {
  const base = {
    ...ui.button,
    width: full ? '100%' : ui.button.width,
    cursor: loading || disabled ? 'default' : 'pointer',
    opacity: loading ? 0.85 : 1,
    transform: loading ? 'scale(0.99)' : 'none',
  };
  const secondary = {
    padding: '10px 14px',
    borderRadius: 10,
    border: ui.btnSecondary.border,
    background: ui.btnSecondary.background,
    color: ui.btnSecondary.color,
    fontWeight: ui.btnSecondary.fontWeight,
  };
  const style = kind === 'primary' ? base : { ...base, ...secondary };

  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      aria-busy={loading ? 'true' : 'false'}
      disabled={disabled || loading}
      style={style}
    >
      {loading ? 'Working…' : children}
    </button>
  );
}

export default function Capture() {
  const { query } = useRouter();
  const turnId = query.id;

  // -------- State --------
  const [shots, setShots] = useState(null);
  const [uploadsByShot, setUploadsByShot] = useState({}); // { [shotId]: [{name,url,width,height,shotId,preview}] }
  const [aiFlags, setAiFlags] = useState([]);             // summary lines
  const [aiByPath, setAiByPath] = useState({});           // { [storagePath]: issues[] }
  const [submitting, setSubmitting] = useState(false);
  const [prechecking, setPrechecking] = useState(false);
  const [templateRules, setTemplateRules] = useState({ property: '', template: '' });
  const [scannedPaths, setScannedPaths] = useState(new Set());
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });

  // Lightbox
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [lightboxPath, setLightboxPath] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // One hidden file input per shot
  const inputRefs = useRef({});

  // -------- Helpers / UI bits --------
  const sevPill = (sev='info') => {
    const bg = sev === 'fail' ? '#3f1a1a' : sev === 'warn' ? '#3a2b10' : '#111b2f';
    const fg = sev === 'fail' ? '#fecaca' : sev === 'warn' ? '#fde68a' : '#cbd5e1';
    return {
      display:'inline-block', padding:'2px 6px', borderRadius:8, fontSize:12, marginRight:6,
      background: bg, color: fg, border: '1px solid rgba(148,163,184,.25)'
    };
  };

  const smallMeta = { fontSize: 12, color: '#94a3b8' };

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
      body: JSON.stringify({ path, expires: 600 })
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

  // ---- EXISTING PHOTO ATTACHMENT HELPERS ----
function groupExistingByShot(items = [], shots = []) {
  // Index shots by shot_id and by area_key so we can match either shape
  const byShotId = new Map();
  const byArea = new Map();
  shots.forEach(s => {
    if (s.shot_id) byShotId.set(String(s.shot_id), s.shot_id);
    if (s.area_key) byArea.set(String(s.area_key), s.shot_id);
  });

  const grouped = {};   // { [shotId]: [files] }
  const misc = [];      // unmatched legacy photos

  for (const it of items) {
    const file = {
      name: it.filename || (it.path?.split('/').pop() || 'photo.jpg'),
      shotId: null,
      url: it.path,             // storage path (we sign when viewing)
      width: it.width || null,
      height: it.height || null,
      preview: null,            // we don't have a local blob
    };

    let target =
      (it.shot_id && byShotId.get(String(it.shot_id))) ||
      (it.area_key && byArea.get(String(it.area_key))) ||
      null;

    if (target) {
      file.shotId = target;
      if (!grouped[target]) grouped[target] = [];
      grouped[target].push(file);
    } else {
      misc.push(file);
    }
  }

  return { grouped, misc };
}

  function openPicker(shotId) {
    const el = inputRefs.current[shotId];
    if (el) el.click();
  }

  // -------- Load required shots (with shot_id) for this turn --------
  useEffect(() => {
    async function loadTemplate() {
      if (!turnId) return;
      try {
        const r = await fetch(`/api/turn-template?turnId=${turnId}`);
        const json = await r.json();
        setTemplateRules(json.rules || { property: '', template: '' });
        if (Array.isArray(json.shots) && json.shots.length) {
          setShots(json.shots.map(s => ({
            shot_id: s.shot_id,
            area_key: s.area_key,
            label: s.label,
            min_count: s.min_count || 1,
            notes: s.notes || '',
            rules_text: s.rules_text || ''
          })));
        } else {
          setShots(DEFAULT_SHOTS);
        }
      } catch {
        setShots(DEFAULT_SHOTS);
      }
    }
    loadTemplate();
  }, [turnId]);

// --- When resuming a turn, load existing photos *after* shots are known ---
useEffect(() => {
  let cancelled = false;

  async function loadExisting() {
    // Need both the turnId and the list of shots to map legacy rows
    if (!turnId || !Array.isArray(shots) || shots.length === 0) return;

    try {
      const r = await fetch(`/api/turns/${turnId}/photos`);
      const j = await r.json().catch(() => ({ items: [] }));
      const items = Array.isArray(j.items) ? j.items : [];
      if (items.length === 0) return;

      const { grouped, misc } = groupExistingByShot(items, shots);
      if (cancelled) return;

      // Merge into current state (avoid duplicates by path/url)
      setUploadsByShot(prev => {
        const next = { ...prev };
        Object.entries(grouped).forEach(([shotId, files]) => {
          const existing = new Set((next[shotId] || []).map(f => f.url));
          next[shotId] = [ ...(next[shotId] || []), ...files.filter(f => !existing.has(f.url)) ];
        });
        if (misc.length) {
          const existingMisc = new Set((next._misc || []).map(f => f.url));
          next._misc = [ ...(next._misc || []), ...misc.filter(f => !existingMisc.has(f.url)) ];
        }
        return next;
      });
    } catch (e) {
      // Non-fatal; user can still add new photos
      console.warn('loadExisting photos failed', e);
    }
  }

  loadExisting();
  return () => { cancelled = true; };
}, [turnId, shots]);

  // -------- Add files (quality + upload to Storage) --------
  async function addFiles(shotId, fileList) {
    const files = Array.from(fileList || []);
    const uploaded = [];

    for (const f of files) {
      const dims = await getDims(f);
      const longest = Math.max(dims.width, dims.height);
      const tooSmall = longest < 1024;
      const tooBig = f.size > 6 * 1024 * 1024;

      if (tooSmall || tooBig) {
        alert(
          `Rejected "${f.name}": ` +
          (tooSmall ? `min longest side is 1024px (got ${dims.width}×${dims.height}). ` : '') +
          (tooBig ? `file > 6MB.` : '')
        );
        continue;
      }

      const preview = URL.createObjectURL(f);

      const up = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, shotId, filename: f.name, mime: f.type })
      }).then(r => r.json());

      if (!up.uploadUrl || !up.path) {
        URL.revokeObjectURL(preview);
        alert('Could not get upload URL; try again.');
        continue;
      }

      await fetch(up.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': up.mime || 'application/octet-stream' },
        body: f
      });

      uploaded.push({ name: f.name, shotId, url: up.path, width: dims.width, height: dims.height, preview });
    }

    if (uploaded.length) {
      setUploadsByShot(prev => ({ ...prev, [shotId]: [ ...(prev[shotId] || []), ...uploaded ] }));
    }
  }

  // Cleanup preview URLs on unmount
  useEffect(() => {
    return () => {
      Object.values(uploadsByShot).flat().forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------- AI Pre-Check (batched) --------
  async function runPrecheck() {
    if (prechecking) return;
    setPrechecking(true);

    const CHUNK_SIZE = 4;
    const PARALLEL   = 3;

    try {
      const localFlags = [];
      const MIN_LONGEST = 1024;

      // Local checks
      Object.entries(uploadsByShot).forEach(([shotId, files]) => {
        files.forEach(f => {
          const longest = Math.max(f.width || 0, f.height || 0);
          if (longest && longest < MIN_LONGEST) {
            localFlags.push(`Low-resolution in shot ${shotId}: ${f.name} (${f.width}×${f.height})`);
          }
        });
      });

      // Build items
      const allItems = [];
      (shots || []).forEach(s => {
        (uploadsByShot[s.shot_id] || []).forEach(f => {
          allItems.push({
            url: f.url,
            area_key: s.area_key || s.label || s.shot_id,
            label: s.label,
            notes: s.notes || '',
            shot_rules: s.rules_text || ''
          });
        });
      });

      const toScan = allItems.filter(it => !scannedPaths.has(it.url));
      setScanProgress({ done: 0, total: toScan.length });

      if (toScan.length === 0) {
        setAiFlags(prev => [...prev, ...localFlags]);
        return;
      }

      const global_rules = {
        property: (templateRules?.property || ''),
        template: (templateRules?.template || '')
      };

      const chunk = (arr, size) =>
        arr.reduce((acc, _, i) => (i % size ? acc : acc.concat([arr.slice(i, i + size)])), []);
      const chunks = chunk(toScan, CHUNK_SIZE);

      const results = [];
      let nextIndex = 0;

      async function worker() {
        while (nextIndex < chunks.length) {
          const myIdx = nextIndex++;
          const items = chunks[myIdx];

          setScanProgress(prev => ({ done: Math.min(prev.done + items.length * 0.5, prev.total), total: prev.total }));

          try {
            const resp = await fetch('/api/vision-scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items, global_rules })
            });
            const json = await resp.json();
            if (Array.isArray(json.results)) results.push(...json.results);
          } catch {
            // continue
          }

          setScanProgress(prev => ({ done: Math.min(prev.done + items.length * 0.5, prev.total), total: prev.total }));
        }
      }

      const workers = Array.from({ length: Math.min(PARALLEL, chunks.length) }, () => worker());
      await Promise.all(workers);

      const perPhoto = { ...aiByPath };
      results.forEach(r => { perPhoto[r.path] = Array.isArray(r.issues) ? r.issues : []; });
      setAiByPath(perPhoto);

      const aiLines = [];
      results.forEach(r => {
        (r.issues || []).forEach(issue => {
          const sev = (issue.severity || 'info').toUpperCase();
          const conf = typeof issue.confidence === 'number' ? ` (${Math.round(issue.confidence * 100)}%)` : '';
          aiLines.push(`${sev} in ${r.area_key || 'unknown'}: ${issue.label}${conf}`);
        });
      });

      setScannedPaths(prev => {
        const next = new Set(prev);
        toScan.forEach(it => next.add(it.url));
        return next;
      });

      setAiFlags(prev => [ ...prev, ...localFlags, ...aiLines ]);
    } finally {
      setPrechecking(false);
      setTimeout(() => setScanProgress({ done: 0, total: 0 }), 600);
    }
  }

  // -------- Submit (enforce min counts per shot) --------
  async function submitAll() {
    if (submitting) return;
    const unmet = (shots || []).filter(s => (s.min_count || 1) > (uploadsByShot[s.shot_id]?.length || 0));
    if (unmet.length) {
      alert('Please add required photos before submitting:\n' + unmet.map(a => `• ${a.label}`).join('\n'));
      return;
    }

    setSubmitting(true);
    try {
      const photos = Object.values(uploadsByShot).flat();
      const resp = await fetch('/api/submit-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, photos })
      });

      if (!resp.ok) {
        const err = await resp.json().catch(() => ({}));
        alert('Submit failed: ' + (err.error || resp.statusText));
        return;
      }
      window.location.href = `/turns/${turnId}/done`;
    } finally {
      setTimeout(() => setSubmitting(false), 300);
    }
  }

  // -------- Render --------
  if (!turnId || shots === null) {
    return (
      <ChromeDark title="Start Taking Photos">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  const pct = scanProgress.total > 0
    ? Math.round((scanProgress.done / scanProgress.total) * 100)
    : null;

  return (
    <ChromeDark title="Start Taking Photos">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          {/* Property name */}
          <h2 style={{ textAlign:'center', margin:'0 0 4px', color: ui.title?.color || '#fff', fontWeight:700 }}>
            {templateRules?.property || ''}
          </h2>

          {/* Tips */}
          <div style={{ ...ui.subtle, color:'#e5e7eb', marginTop: 12 }}>
            ✅ Tap + inside the box to take a picture
          </div>
          <div style={{ ...ui.subtle, color:'#e5e7eb', marginTop: 6 }}>
            ✅ Run AI Pre-Check before submitting
          </div>

          {/* Optional Turn ID */}
          {typeof window !== 'undefined' &&
            new URLSearchParams(window.location.search).get('showId') === '1' && (
            <div style={{ ...smallMeta, marginTop: 6 }}>
              Turn ID: <code style={{ userSelect:'all' }}>{turnId}</code>
            </div>
          )}

          {shots.map(s => {
            const files = uploadsByShot[s.shot_id] || [];
            const required = s.min_count || 1;
            const missing = Math.max(0, required - files.length);

            return (
              <div
                key={s.shot_id}
                style={{
                  border: ui.card.border,
                  borderRadius: 12,
                  padding: 12,
                  margin: '12px 0',
                  background: ui.card.background
                }}
              >
                {/* Hidden input per shot */}
                <input
                  ref={el => { inputRefs.current[s.shot_id] = el; }}
                  type="file"
                  accept="image/*"
                  capture="environment"
                  multiple
                  style={{ display:'none' }}
                  onChange={(e)=>addFiles(s.shot_id, e.target.files)}
                />

                <div style={{ display:'flex', justifyContent:'space-between', alignItems:'flex-start', gap:12 }}>
                  <div>
                    <b>{s.label}</b>
                    {s.notes ? <div style={{ ...smallMeta }}>{s.notes}</div> : null}
                    <div
                      style={{
                        fontSize: 12,
                        marginTop: 4,
                        color: missing > 0 ? '#f59e0b' : '#22c55e'
                      }}
                    >
                      Required: {required} • Uploaded: {files.length} {missing>0 ? `• Missing: ${missing}` : '• ✅'}
                    </div>
                  </div>

                  <ThemedButton kind="secondary" onClick={() => openPicker(s.shot_id)} ariaLabel={`Add photo for ${s.label}`}>
                    ➕ Add photo
                  </ThemedButton>
                </div>

                {/* File cards + placeholders */}
                <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16 }}>
                  {/* Existing uploads */}
                  {files.map(f => (
                    <div key={f.url} style={{ border: ui.card.border, borderRadius:10, padding:10, background: '#0b1220' }}>
                      {/* Thumbnail preview */}
                      {f.preview && (
                        <div style={{ marginBottom:8 }}>
                          <img
                            src={f.preview}
                            alt={f.name}
                            style={{ width: '100%', height: 160, objectFit: 'cover', borderRadius: 8 }}
                            draggable={false}
                          />
                        </div>
                      )}

                      <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                        <div style={{ fontSize:13, maxWidth:'70%' }}>
                          <b title={f.name}>{f.name}</b><br/>
                          {f.width}×{f.height}
                        </div>
                        <ThemedButton kind="secondary" onClick={() => viewPhoto(f.url)} ariaLabel={`View ${f.name}`}>
                          👁️ View
                        </ThemedButton>
                      </div>

                      {/* AI flags under each photo */}
                      {Array.isArray(aiByPath[f.url]) && aiByPath[f.url].length > 0 && (
                        <div>
                          {aiByPath[f.url].map((iss, idx) => (
                            <div key={idx} style={{ marginBottom:4 }}>
                              <span style={sevPill(iss.severity)}>{(iss.severity || 'info').toUpperCase()}</span>
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

                  {/* Placeholders for missing photos */}
                  {Array.from({ length: missing }).map((_, i) => (
                    <button
                      key={`ph-${s.shot_id}-${i}`}
                      onClick={() => openPicker(s.shot_id)}
                      aria-label={`Add required photo for ${s.label}`}
                      style={{
                        border:'2px dashed #334155',
                        borderRadius:12,
                        padding:'20px 14px',
                        background:'transparent',
                        cursor:'pointer',
                        display:'flex',
                        flexDirection:'column',
                        alignItems:'center',
                        justifyContent:'center',
                        minHeight:160,
                        userSelect:'none',
                        WebkitTapHighlightColor:'transparent',
                        color:'#cbd5e1'
                      }}
                    >
                      <div style={{ fontSize:30, lineHeight:1, color:'#94a3b8', marginBottom:8 }}>＋</div>
                      <div style={{ fontSize:15 }}>Tap to add required photo</div>
                      <div style={{ fontSize:12, color:'#94a3b8', marginTop:4 }}>{s.label}</div>
                    </button>
                  ))}
                </div>
              </div>
            );
          })}

          {/* AI findings summary */}
          <div style={{ border:'1px dashed #334155', borderRadius:12, padding:12, marginTop:16, background: ui.card.background }}>
            <div style={{ fontWeight:600, marginBottom:8 }}>AI Findings</div>
            {aiFlags.length === 0 ? (
              <div style={ui.subtle}>No findings yet — tap “Run AI Pre-Check”.</div>
            ) : (
              <ul style={{ marginLeft:18 }}>
                {aiFlags.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
          </div>

          {/* Buttons + progress */}
          <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:16, maxWidth:420 }}>
            <ThemedButton
              onClick={runPrecheck}
              loading={prechecking}
              kind="primary"
              ariaLabel="Run AI Pre-Check"
            >
              {prechecking && scanProgress.total > 0
                ? `🔎 Scanning ${scanProgress.done}/${scanProgress.total} (${pct}%)`
                : '🔎 Run AI Pre-Check'}
            </ThemedButton>

            {prechecking && scanProgress.total > 0 && (
              <div>
                <div style={{ height:8, background:'#1f2937', borderRadius:6, overflow:'hidden' }}>
                  <div
                    style={{
                      height:'100%',
                      width: `${pct}%`,
                      background: '#0ea5e9',
                      transition:'width 200ms ease'
                    }}
                  />
                </div>
                <div style={{ fontSize:12, color:'#94a3b8', marginTop:6 }}>
                  Scanning {scanProgress.done} of {scanProgress.total}…
                </div>
              </div>
            )}

            <ThemedButton
              onClick={submitAll}
              loading={submitting}
              kind="secondary"
              ariaLabel="Submit Turn"
              full
            >
              ✅ Submit Turn
            </ThemedButton>
          </div>
        </div>
      </section>

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
              <ThemedButton kind="secondary" onClick={closeLightbox}>✖ Close (Esc)</ThemedButton>
              <div style={{ flex:1 }} />
              <ThemedButton kind="secondary" onClick={zoomOut}>➖ Zoom</ThemedButton>
              <ThemedButton kind="secondary" onClick={zoomIn}>➕ Zoom</ThemedButton>
              <ThemedButton kind="secondary" onClick={rotateLeft}>⟲ Rotate</ThemedButton>
              <ThemedButton kind="secondary" onClick={rotateRight}>⟳ Rotate</ThemedButton>
              <ThemedButton kind="secondary" onClick={refreshSignedUrl}>⟳ Refresh URL</ThemedButton>
              <ThemedButton kind="secondary" onClick={downloadCurrent}>⬇ Download</ThemedButton>
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
    </ChromeDark>
  );
}
