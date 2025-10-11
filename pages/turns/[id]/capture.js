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

// ---- helper used by thumbnails (defined once, not inside a loop) ----
function ensureThumb(path, setThumbByPath, requestedThumbsRef, signPath) {
  if (!path) return;
  if (requestedThumbsRef.current.has(path)) return;
  requestedThumbsRef.current.add(path);
  signPath(path)
    .then((url) => {
      if (!url) return;
      // don't overwrite if another signer already set it
      setThumbByPath((prev) => (prev[path] ? prev : { ...prev, [path]: url }));
    })
    .catch(() => {
      // allow retry if signing failed
      requestedThumbsRef.current.delete(path);
    });
}

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

  // Signed thumbnail cache for existing photos
  const [thumbByPath, setThumbByPath] = useState({});      // { [storagePath]: signedUrl }
  const requestedThumbsRef = useRef(new Set());            // to avoid duplicate signing

  // Needs-fix notes (from manager)
  const [fixNotes, setFixNotes] = useState({
  byPath: {},   // { [storagePath]: note }
  byBase: {},   // { [basename]: note }  <-- NEW
  overall: '',
  count: 0,
  });
  const [hideFixBanner, setHideFixBanner] = useState(false);

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

  // ---- EXISTING PHOTO ATTACHMENT HELPERS (robust matching) ----
  function norm(s) {
    return String(s || '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');
  }

  function groupExistingByShot(items = [], shots = []) {
    // Build lookup maps
    const byShotId = new Map();   // normalized shot_id  -> shot_id
    const byArea   = new Map();   // normalized area_key -> shot_id
    const byLabel  = new Map();   // normalized label    -> shot_id

    shots.forEach(s => {
      if (s.shot_id) byShotId.set(norm(s.shot_id), s.shot_id);
      if (s.area_key) byArea.set(norm(s.area_key), s.shot_id);
      if (s.label) byLabel.set(norm(s.label), s.shot_id);
    });

    const grouped = {}; // { [shotId]: [files] }
    const misc = [];

    for (const it of items) {
      const file = {
        name: it.filename || (it.path?.split('/').pop() || 'photo.jpg'),
        shotId: null,
        url: it.path,                  // storage path (viewer will sign it)
        width: it.width || null,
        height: it.height || null,
        preview: null,
      };

      // Try in order: exact shot_id, area_key, label (all normalized)
      const tryShot  = byShotId.get(norm(it.shot_id));
      const tryArea  = byArea.get(norm(it.area_key));
      const tryLabel = byLabel.get(norm(it.label));

      const target = tryShot || tryArea || tryLabel || null;

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

  // --- Load existing photos AFTER shots are known ---
  useEffect(() => {
    async function loadExisting() {
      if (!turnId || !Array.isArray(shots)) return;

      try {
        const r = await fetch(`/api/turns/${turnId}/photos`);
        const j = await r.json();
        const items = Array.isArray(j.items) ? j.items : [];
        if (items.length === 0) return;

        // Robust grouping (accept area_key/label fallbacks)
        const { grouped, misc } = groupExistingByShot(items, shots);

        // Add a pseudo-shot for unmatched photos
        if (misc.length > 0 && !shots.some(s => s.shot_id === '__extras__')) {
          setShots(prev => [
            ...(prev || []),
            {
              shot_id: '__extras__',
              area_key: 'existing_uploads',
              label: 'Additional uploads',
              min_count: 0,
              notes: 'Uploaded previously; not tied to a required shot',
              rules_text: '',
            },
          ]);
          grouped['__extras__'] = misc;
        }

        // Merge into state (avoid dupes by path)
        setUploadsByShot(prev => {
          const next = { ...prev };
          Object.entries(grouped).forEach(([key, arr]) => {
            const existing = new Set((next[key] || []).map(f => f.url));
            const merged = (next[key] || []).concat(arr.filter(f => !existing.has(f.url)));
            next[key] = merged;
          });
          return next;
        });
      } catch {
        // ignore
      }
    }
    loadExisting();
  }, [turnId, shots]);

 // --- Fetch needs-fix notes (overall + per-photo) ---
useEffect(() => {
  if (!turnId) return;

  let cancelled = false;

  (async () => {
    try {
      const r = await fetch(`/api/turns/${turnId}/notes`);
      if (!r.ok) return; // endpoint may not exist yet; silently ignore
      const j = await r.json().catch(() => ({}));

      // Accept several shapes
      // A) { overall_note, items:[{path, note, needs_fix}] }
      // B) { notes:{overall, items:[{path, note, needs_fix}]}}
      // C) { photos:[{path, note, needs_fix}], overall?:string }
      const overall =
        j.overall_note ||
        j?.notes?.overall ||
        j.overall ||
        '';

      const list =
        (Array.isArray(j.items) ? j.items :
        Array.isArray(j?.notes?.items) ? j.notes.items :
        Array.isArray(j.photos) ? j.photos :
        []);

      const byPath = {};
const byBase = {};
list.forEach(it => {
  const p = it?.path;
  const n = it?.note || it?.notes || '';
  if (!p || !n) return;
  byPath[p] = n;
  const base = p.split('/').pop()?.toLowerCase();
  if (base) byBase[base] = n;
});

if (!cancelled) {
  setFixNotes({
    byPath,
    byBase,               // NEW
    overall: String(overall || ''),
    count: Object.keys(byPath).length || Object.keys(byBase).length,
  });
}


      const count = Object.values(byPath).filter(v => v.needs_fix || v.note).length;

      if (!cancelled) {
        setFixNotes({
          byPath,
          overall: String(overall || ''),
          count
        });
      }
    } catch {
      // ignore
    }
  })();

  return () => { cancelled = true; };
}, [turnId]);

  // --- Sign storage paths to show thumbnails for existing uploads ---
  useEffect(() => {
    // Collect any file paths that don't have a signed thumbnail yet
    const pending = [];
    Object.values(uploadsByShot).forEach(arr => {
      (arr || []).forEach(f => {
        const path = f.url;
        if (!path) return;
        if (thumbByPath[path]) return;
        if (requestedThumbsRef.current.has(path)) return;
        requestedThumbsRef.current.add(path);
        pending.push(path);
      });
    });

    if (pending.length === 0) return;

    let cancelled = false;

    async function worker(paths) {
      for (const p of paths) {
        try {
          const url = await signPath(p);
          if (!cancelled && url) {
            setThumbByPath(prev => (prev[p] ? prev : { ...prev, [p]: url }));
          }
        } catch {
          // ignore one-off signing failures
        }
      }
    }

    const PARALLEL = 3;
    const chunks = Array.from({ length: PARALLEL }, (_, i) =>
      pending.filter((_, idx) => idx % PARALLEL === i)
    );
    chunks.forEach(c => worker(c));

    return () => { cancelled = true; };
  }, [uploadsByShot, thumbByPath]);

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

  const hasFixes = fixNotes.count > 0;

  return (
    <ChromeDark title="Start Taking Photos">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          {/* Property name */}
          <h2 style={{ textAlign:'center', margin:'0 0 4px', color: ui.title?.color || '#fff', fontWeight:700 }}>
            {templateRules?.property || ''}
          </h2>

          {/* Needs-fix banner (if any) */}
          {hasFixes && !hideFixBanner && (
            <div
              style={{
                marginTop: 10,
                padding: '10px 12px',
                border: '1px solid #d97706',
                background: '#4a2f04',
                color: '#fcd34d',
                borderRadius: 10,
              }}
            >
              <div style={{ fontWeight: 700, marginBottom: 4 }}>
                {fixNotes.count} {fixNotes.count === 1 ? 'photo needs' : 'photos need'} fixes
              </div>
              {fixNotes.overall ? (
                <div style={{ fontSize: 13, lineHeight: 1.35 }}>{fixNotes.overall}</div>
              ) : null}
              <div style={{ marginTop: 8 }}>
                <button
                  type="button"
                  onClick={() => setHideFixBanner(true)}
                  style={{ ...ui.btnSecondary, padding: '6px 10px' }}
                >
                  Dismiss
                </button>
              </div>
            </div>
          )}

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
                  {/* Existing + newly uploaded files */}
                  {files.map(f => {
                    // trigger signing if needed
                    if (!f.preview && !thumbByPath[f.url]) {
                      ensureThumb(f.url, setThumbByPath, requestedThumbsRef, signPath);
                    }
                    const thumb = f.preview || thumbByPath[f.url] || null;
                    const fx = fixNotes.byPath[f.url] || {};
                    const flagged = !!(fx.needs_fix || fx.note);
                    const note = fx.note || '';


                    return (
                      <div
                        key={f.url}
                        data-path={f.url}
                        style={{
                          border: flagged ? '1px solid #d97706' : ui.card.border,
                          borderRadius:10,
                          padding:10,
                          background: '#0b1220',
                          boxShadow: flagged ? '0 0 0 3px rgba(217,119,6,0.15)' : 'none'
                        }}
                      >
                        <div style={{ position:'relative', marginBottom:8, height:160 }}>
                          {thumb ? (
                            <img
                              src={thumb}
                              alt={f.name}
                              style={{ width:'100%', height:160, objectFit:'cover', borderRadius:8 }}
                              draggable={false}
                            />
                          ) : (
                            <div
                              style={{
                                width:'100%', height:160, borderRadius:8,
                                background:'linear-gradient(90deg,#0f172a,#111827,#0f172a)',
                                backgroundSize:'200% 100%'
                              }}
                            />
                          )}

                          {flagged && (
                            <span
                              style={{
                                position:'absolute',
                                top:8, left:8,
                                background:'#4a2f04',
                                color:'#fcd34d',
                                border:'1px solid #d97706',
                                borderRadius:999,
                                fontSize:12,
                                fontWeight:700,
                                padding:'2px 8px'
                              }}
                            >
                              Needs fix
                            </span>
                          )}
                        </div>

                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                          <div style={{ fontSize:13, maxWidth:'70%' }}>
                            <b title={f.name}>{f.name}</b><br/>
                            {f.width}×{f.height}
                          </div>
                          <ThemedButton kind="secondary" onClick={() => viewPhoto(f.url)} ariaLabel={`View ${f.name}`}>
                            👁️ View
                          </ThemedButton>
                        </div>

                        {/* Per-photo manager note (if flagged) */}
                        {flagged && (
                          <div
                            style={{
                              marginTop:6,
                              padding:'8px 10px',
                              border:'1px dashed #d97706',
                              background:'#3a2b10',
                              color:'#fde68a',
                              borderRadius:8,
                              fontSize:13,
                              whiteSpace:'pre-wrap'
                            }}
                          >
                            {note}
                          </div>
                        )}

                        {/* AI flags under each photo */}
                        {Array.isArray(aiByPath[f.url]) && aiByPath[f.url].length > 0 && (
                          <div style={{ marginTop: flagged ? 8 : 0 }}>
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
                    );
                  })}

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

          {/* Unmatched legacy photos bucket */}
          {Array.isArray(uploadsByShot._misc) && uploadsByShot._misc.length > 0 && (
            <div style={{ border:'1px solid #334155', borderRadius:12, padding:12, margin:'12px 0', background:'#0f172a' }}>
              <div style={{ fontWeight:700, marginBottom:6 }}>Other uploads</div>
              <div style={{ fontSize:12, color:'#94a3b8', marginBottom:8 }}>
                These photos were attached to the turn but didn’t match any current shot.
              </div>
              <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16 }}>
                {uploadsByShot._misc.map(f => {
                  if (!thumbByPath[f.url]) {
                    ensureThumb(f.url, setThumbByPath, requestedThumbsRef, signPath);
                  }
                  const thumb = thumbByPath[f.url] || null;
                  const fx = fixNotes.byPath[f.url] || {};
                  const flagged = !!(fx.needs_fix || fx.note);
                  const note = fixNotes.byPath[f.url];
                  const flagged = !!note;



                  return (
                    <div
                      key={f.url}
                      style={{
                        border: flagged ? '1px solid #d97706' : '1px solid #334155',
                        borderRadius:10,
                        padding:10,
                        background:'#0b1220',
                        boxShadow: flagged ? '0 0 0 3px rgba(217,119,6,0.15)' : 'none'
                      }}
                    >
                      <div style={{ position:'relative', marginBottom:8, height:160 }}>
                        {thumb ? (
                          <img
                            src={thumb}
                            alt={f.name}
                            style={{ width:'100%', height:160, objectFit:'cover', borderRadius:8 }}
                            draggable={false}
                          />
                        ) : (
                          <div
                            style={{
                              width:'100%', height:160, borderRadius:8,
                              background:'linear-gradient(90deg,#0f172a,#111827,#0f172a)',
                              backgroundSize:'200% 100%'
                            }}
                          />
                        )}
                        {flagged && (
                          <span
                            style={{
                              position:'absolute',
                              top:8, left:8,
                              background:'#4a2f04',
                              color:'#fcd34d',
                              border:'1px solid #d97706',
                              borderRadius:999,
                              fontSize:12,
                              fontWeight:700,
                              padding:'2px 8px'
                            }}
                          >
                            Needs fix
                          </span>
                        )}
                      </div>
                      <div style={{ fontSize:13, marginBottom:6, color:'#e5e7eb' }}>
                        <b title={f.name}>{f.name}</b><br/>
                        {f.width && f.height ? `${f.width}×${f.height}` : null}
                      </div>
                      {flagged && (
                        <div
                          style={{
                            marginTop:6,
                            padding:'8px 10px',
                            border:'1px dashed #d97706',
                            background:'#3a2b10',
                            color:'#fde68a',
                            borderRadius:8,
                            fontSize:13,
                            whiteSpace:'pre-wrap'
                          }}
                        >
                          {note}
                        </div>
                      )}
                      <div style={{ marginTop:8 }}>
                        <ThemedButton kind="secondary" onClick={() => viewPhoto(f.url)} ariaLabel={`View ${f.name}`}>
                          👁️ View
                        </ThemedButton>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

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
