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

/** Touch-friendly button with built-in loading + debounce */
function BigButton({ children, onPress, loading=false, kind='primary', full=false, ariaLabel }) {
  const busyRef = useRef(false);
  const lastFireRef = useRef(0);

  const handlePointerUp = async (e) => {
    e.preventDefault();
    if (loading || busyRef.current) return;
    const now = Date.now();
    if (now - lastFireRef.current < 250) return;
    lastFireRef.current = now;

    try {
      busyRef.current = true;
      await onPress?.();
    } finally {
      setTimeout(() => { busyRef.current = false; }, 200);
    }
  };

  const styles = {
    base: {
      userSelect: 'none',
      WebkitTapHighlightColor: 'transparent',
      outline: 'none',
      cursor: loading ? 'default' : 'pointer',
      fontWeight: 600,
      fontSize: 16,
      lineHeight: '22px',
      padding: '14px 18px',
      minHeight: 48,
      borderRadius: 12,
      border: '1px solid transparent',
      display: 'inline-flex',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      width: full ? '100%' : 'auto',
      transition: 'transform 80ms ease, opacity 120ms ease',
      transform: loading ? 'scale(0.99)' : 'none',
      opacity: loading ? 0.85 : 1,
      boxSizing: 'border-box'
    },
    primary: { background: '#0ea5e9', color: '#fff' },
    // Themed secondary (TurnQA Midnight)
    secondary: { background: '#111827', color: '#e5e7eb', border: '1px solid #334155' }
  };

  const style = { ...styles.base, ...(kind === 'primary' ? styles.primary : styles.secondary) };

  return (
    <button
      type="button"
      onPointerUp={handlePointerUp}
      aria-label={ariaLabel}
      aria-busy={loading ? 'true' : 'false'}
      disabled={loading}
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
  const [shots, setShots] = useState(null);                     // [{shot_id, area_key, label, min_count, notes, rules_text}]
  const [uploadsByShot, setUploadsByShot] = useState({});       // { [shotId]: [{name,url,width,height,shotId,preview}] }
  const [aiFlags, setAiFlags] = useState([]);                   // combined findings
  const [aiByPath, setAiByPath] = useState({});                 // { [storagePath]: issues[] }
  const [submitting, setSubmitting] = useState(false);
  const [prechecking, setPrechecking] = useState(false);
  const [templateRules, setTemplateRules] = useState({ property: '', template: '' });
  const [scannedPaths, setScannedPaths] = useState(new Set());  // Cache of paths we’ve already scanned in this session
  const [scanProgress, setScanProgress] = useState({ done: 0, total: 0 });

  // --- Lightbox state ---
  const [lightboxOpen, setLightboxOpen] = useState(false);
  const [lightboxUrl, setLightboxUrl] = useState(null);
  const [lightboxPath, setLightboxPath] = useState(null);
  const [zoom, setZoom] = useState(1);
  const [rotation, setRotation] = useState(0);

  // One hidden file input per shot
  const inputRefs = useRef({});

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

  // Cleanup preview URLs on unmount to avoid memory leaks
  useEffect(() => {
    return () => {
      Object.values(uploadsByShot).flat().forEach(f => {
        if (f.preview) URL.revokeObjectURL(f.preview);
      });
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // -------- AI Pre-Check (local + OpenAI vision) — batched & progress --------
  async function runPrecheck() {
    if (prechecking) return;
    setPrechecking(true);

    // Tune to taste
    const CHUNK_SIZE = 4;   // images per API call
    const PARALLEL   = 3;   // concurrent API calls

    try {
      const localFlags = [];
      const MIN_LONGEST = 1024;

      // Local quality checks
      Object.entries(uploadsByShot).forEach(([shotId, files]) => {
        files.forEach(f => {
          const longest = Math.max(f.width || 0, f.height || 0);
          if (longest && longest < MIN_LONGEST) {
            localFlags.push(`Low-resolution in shot ${shotId}: ${f.name} (${f.width}×${f.height})`);
          }
        });
      });

      // Build all items with context
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

      // Skip ones we already scanned
      const toScan = allItems.filter(it => !scannedPaths.has(it.url));

      // Init progress
      setScanProgress({ done: 0, total: toScan.length });

      if (toScan.length === 0) {
        setAiFlags(prev => [...prev, ...localFlags]);
        return;
      }

      const global_rules = {
        property: (templateRules?.property || ''),
        template: (templateRules?.template || '')
      };

      // chunk helper
      const chunk = (arr, size) =>
        arr.reduce((acc, _, i) => (i % size ? acc : acc.concat([arr.slice(i, i + size)])), []);

      const chunks = chunk(toScan, CHUNK_SIZE);

      const results = [];
      let nextIndex = 0;

      async function worker() {
        while (nextIndex < chunks.length) {
          const myIdx = nextIndex++;
          const items = chunks[myIdx];

          // Give half progress when dispatching this batch
          setScanProgress(prev => ({
            done: Math.min(prev.done + items.length * 0.5, prev.total),
            total: prev.total
          }));

          try {
            const resp = await fetch('/api/vision-scan', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ items, global_rules })
            });
            const json = await resp.json();
            if (Array.isArray(json.results)) {
              results.push(...json.results);
            }
          } catch (e) {
            console.warn('vision batch failed', e);
            continue;
          }

          // Grant the remaining half when the batch completes
          setScanProgress(prev => ({
            done: Math.min(prev.done + items.length * 0.5, prev.total),
            total: prev.total
          }));
        }
      }

      // run limited concurrency
      const workers = Array.from({ length: Math.min(PARALLEL, chunks.length) }, () => worker());
      await Promise.all(workers);

      // Merge per-photo issues
      const perPhoto = { ...aiByPath };
      results.forEach(r => {
        perPhoto[r.path] = Array.isArray(r.issues) ? r.issues : [];
      });
      setAiByPath(perPhoto);

      // Summary lines
      const aiLines = [];
      results.forEach(r => {
        (r.issues || []).forEach(issue => {
          const sev = (issue.severity || 'info').toUpperCase();
          const conf = typeof issue.confidence === 'number' ? ` (${Math.round(issue.confidence * 100)}%)` : '';
          aiLines.push(`${sev} in ${r.area_key || 'unknown'}: ${issue.label}${conf}`);
        });
      });

      // Remember scanned paths
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
          {/* Sub-title: Property name (centered) */}
          <h2 style={{ textAlign:'center', margin:'0 0 4px', color:'#fff', fontWeight:700 }}>
            {templateRules?.property || ''}
          </h2>

          {/* Cleaner tips (white for readability) */}
          <div style={{ marginTop: 12, color: '#fff', fontSize: 14 }}>
            ✅ Tap + inside the box to take a picture
          </div>
          <div style={{ marginTop: 6, color: '#fff', fontSize: 14 }}>
            ✅ Run AI Pre-Check before submitting
          </div>

          {/* Show Turn ID only if ?showId=1 is in the URL */}
          {typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('showId') === '1' && (
            <div style={{ color:'#94a3b8', fontSize: 12, marginTop: 6 }}>
              Turn ID: <code style={{ userSelect:'all' }}>{turnId}</code>
            </div>
          )}

          {shots.map(s => {
            const files = uploadsByShot[s.shot_id] || [];
            const required = s.min_count || 1;
            const missing = Math.max(0, required - files.length);

            return (
              <div key={s.shot_id} style={{ border:'1px solid #334155', borderRadius:12, padding:12, margin:'12px 0', background:'#0f172a' }}>
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
                    {s.notes ? <div style={{ fontSize:12, color:'#94a3b8' }}>{s.notes}</div> : null}
                    <div style={{ fontSize:12, marginTop:4, color: missing>0 ? '#f59e0b' : '#22c55e' }}>
                      Required: {required} • Uploaded: {files.length} {missing>0 ? `• Missing: ${missing}` : '• ✅'}
                    </div>
                  </div>
                  <BigButton kind="secondary" onPress={() => openPicker(s.shot_id)} ariaLabel={`Add photo for ${s.label}`}>
                    ➕ Add photo
                  </BigButton>
                </div>

                {/* File cards + placeholders */}
                <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16 }}>
                  {/* Existing uploads */}
                  {files.map(f => (
                    <div key={f.url} style={{ border:'1px solid #334155', borderRadius:10, padding:10, background:'#0b1220' }}>
                      {/* Thumbnail preview (local, immediate) */}
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
                        <div style={{ fontSize:13, maxWidth:'70%', color:'#e5e7eb' }}>
                          <b title={f.name}>{f.name}</b><br/>
                          {f.width}×{f.height}
                        </div>
                        <BigButton kind="secondary" onPress={() => viewPhoto(f.url)} ariaLabel={`View ${f.name}`}>
                          👁️ View
                        </BigButton>
                      </div>

                      {/* AI flags under each photo */}
                      {Array.isArray(aiByPath[f.url]) && aiByPath[f.url].length > 0 && (
                        <div>
                          {aiByPath[f.url].map((iss, idx) => (
                            <div key={idx} style={{ marginBottom:4 }}>
                              <span style={sevStyle(iss.severity)}>{(iss.severity || 'info').toUpperCase()}</span>
                              <span style={{ fontSize:13, color:'#e5e7eb' }}>
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
                      onPointerUp={() => openPicker(s.shot_id)}
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
          <div style={{ border:'1px dashed #334155', borderRadius:12, padding:12, marginTop:16, background:'#0f172a' }}>
            <div style={{ fontWeight:600, marginBottom:8 }}>AI Findings</div>
            {aiFlags.length === 0 ? (
              <div style={{ color:'#94a3b8' }}>No findings yet — tap “Run AI Pre-Check”.</div>
            ) : (
              <ul style={{ marginLeft:18 }}>
                {aiFlags.map((f, i) => <li key={i}>{f}</li>)}
              </ul>
            )}
          </div>

          {/* Buttons + progress */}
          <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:16, maxWidth:420 }}>
            <BigButton
              onPress={runPrecheck}
              loading={prechecking}
              kind="primary"
              ariaLabel="Run AI Pre-Check"
            >
              {prechecking && scanProgress.total > 0
                ? `🔎 Scanning ${scanProgress.done}/${scanProgress.total} (${pct}%)`
                : '🔎 Run AI Pre-Check'}
            </BigButton>

            {prechecking && scanProgress.total > 0 && (
              <div>
                <div style={{ height:8, background:'#1f2937', borderRadius:6, overflow:'hidden' }}>
                  <div style={{
                    height:'100%',
                    width: `${pct}%`,
                    background:'#0ea5e9',
                    transition:'width 200ms ease'
                  }} />
                </div>
                <div style={{ fontSize:12, color:'#94a3b8', marginTop:6 }}>
                  Scanning {scanProgress.done} of {scanProgress.total}…
                </div>
              </div>
            )}

            <BigButton
              onPress={submitAll}
              loading={submitting}
              kind="secondary"
              ariaLabel="Submit Turn"
              full
            >
              ✅ Submit Turn
            </BigButton>
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
              <button onClick={closeLightbox} style={{ padding:'10px 12px', fontSize:14, borderRadius:10 }}>✖ Close (Esc)</button>
              <div style={{ flex:1 }} />
              <button onClick={zoomOut} style={{ padding:'10px 12px', fontSize:14, borderRadius:10 }}>➖ Zoom</button>
              <button onClick={zoomIn} style={{ padding:'10px 12px', fontSize:14, borderRadius:10 }}>➕ Zoom</button>
              <button onClick={rotateLeft} style={{ padding:'10px 12px', fontSize:14, borderRadius:10 }}>⟲ Rotate</button>
              <button onClick={rotateRight} style={{ padding:'10px 12px', fontSize:14, borderRadius:10 }}>⟳ Rotate</button>
              <button onClick={refreshSignedUrl} style={{ padding:'10px 12px', fontSize:14, borderRadius:10 }}>⟳ Refresh URL</button>
              <button onClick={downloadCurrent} style={{ padding:'10px 12px', fontSize:14, borderRadius:10 }}>⬇ Download</button>
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
