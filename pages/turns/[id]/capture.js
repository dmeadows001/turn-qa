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
  const turnId = typeof query.id === 'string' ? query.id : '';
  const tab = typeof query.tab === 'string' ? query.tab : 'capture'; // 'needs-fix' when coming from SMS

  // --- Guard: define isFixMode so incidental references don't crash (e.g., in alerts/traces) ---
  const isFixMode = (() => {
    try {
      const sp = new URLSearchParams(window.location.search);
      const t = String(sp.get('tab') || '').toLowerCase();
      return t === 'needs-fix' || t === 'needs_fix' || t === 'fix';
    } catch {
      return false;
    }
  })();
  if (typeof window !== 'undefined') {
    window.__CAPTURE_DEBUG__ = window.__CAPTURE_DEBUG__ || {};
    window.__CAPTURE_DEBUG__.isFixMode = isFixMode;
  }

  useEffect(() => {
    if (!turnId) return;
    if (tab === 'needs-fix') return; // allow fix flow to use this page
    (async () => {
      try {
        const r = await fetch(`/api/get-turn?id=${turnId}`);
        if (!r.ok) return;
        const j = await r.json().catch(() => ({}));
        const t = j && (j.turn || null);
        if (t && t.status === 'in_progress') {
          // If launcher initiated this visit, do NOT bounce (prevents loop).
          try {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('from') === 'capture') return;
          } catch {}
          let dest = `/capture?turn=${encodeURIComponent(turnId)}`;
          try {
            const sp = new URLSearchParams(window.location.search);
            if (sp.get('debug') === '1') dest += '&debug=1';
          } catch {}
          try { console.log('[TurnQA][capture] guard redirect ->', dest); } catch {}
          window.location.replace(dest);
        }
      } catch {}
    })();
  }, [turnId, tab]);

  // -------- State --------
  const [shots, setShots] = useState(null);
  // files we render per-shot; each file: {name, url (storage path), width, height, shotId, preview?, isFix?, cleanerNote?}
  const [uploadsByShot, setUploadsByShot] = useState({});
  const [submitting, setSubmitting] = useState(false);
  const [templateRules, setTemplateRules] = useState({ property: '', template: '' });

  // Signed thumbnail cache for existing/new photos
  const [thumbByPath, setThumbByPath] = useState({});
  const requestedThumbsRef = useRef(new Set());

  // Needs-fix (manager) notes to show to cleaner, by storage path
  const [fixNotes, setFixNotes] = useState({ byPath: {}, overall: '', count: 0 });
  const [hideFixBanner, setHideFixBanner] = useState(false);

  // Cleaner overall reply (optional)
  const [reply, setReply] = useState('');

  // Per-new-photo cleaner notes (keyed by storage path)
  const [cleanerNoteByNewPath, setCleanerNoteByNewPath] = useState({});

  // One hidden file input per shot
  const inputRefs = useRef({});

  // ------- helpers -------
  const smallMeta = { fontSize: 12, color: '#94a3b8' };

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

  // --- Image dimension helper (safe if load fails) ---
  async function getDims(file) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          const dims = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
          URL.revokeObjectURL(img.src);
          resolve(dims);
        };
        img.onerror = () => {
          // If we can't read dimensions (e.g., HEIC on some desktops), don't block upload
          resolve({ width: 0, height: 0 });
        };
        img.src = URL.createObjectURL(file);
      } catch {
        resolve({ width: 0, height: 0 });
      }
    });
  }
  
  function ensureThumb(path) {
    if (!path || requestedThumbsRef.current.has(path) || thumbByPath[path]) return;
    requestedThumbsRef.current.add(path);
    signPath(path).then(url => {
      if (url) setThumbByPath(prev => (prev[path] ? prev : { ...prev, [path]: url }));
    }).catch(() => {
      requestedThumbsRef.current.delete(path);
    });
  }

  function openPicker(shotId) {
    inputRefs.current[shotId]?.click();
  }

 // --- Load existing photos for this turn (ensures we only bucket into *visible* shots) ---
useEffect(() => {
  async function loadExisting() {
    if (!turnId || !Array.isArray(shots)) return;
    try {
      const r = await fetch(`/api/list-turn-photos?id=${turnId}`);
      const j = await r.json();
      const items = Array.isArray(j.photos) ? j.photos : [];

        if (typeof window !== 'undefined') {
        window.__CAPTURE_DEBUG__ = window.__CAPTURE_DEBUG__ || {};
        window.__CAPTURE_DEBUG__.rawPhotos = items;
        console.log('[capture] /api/list-turn-photos items:', items);
      }


      // Build quick lookups for currently visible shots
      const shotIdSet = new Set(shots.map(s => s.shot_id));
      const areaToShotId = new Map(
        shots.map(s => [String(s.area_key || '').toLowerCase(), s.shot_id])
      );

// Group by *currently visible* shot; otherwise bucket to __extras__
const byShot = {};

for (const it of items) {
  const path = it.path || '';
  if (!path) continue; // only skip truly empty paths

  let targetShot = null;
  // 1) Prefer a valid shot_id if it exists in current shots
  if (it.shot_id && shotIdSet.has(it.shot_id)) {
    targetShot = it.shot_id;
  } else {
    // 2) Else soft-match by area_key only if that area exists in current shots
    const ak = String(it.area_key || '').toLowerCase();
    if (ak && areaToShotId.has(ak)) {
      targetShot = areaToShotId.get(ak);
    }
  }

  // 3) If still not mapped to a visible shot, bucket to __extras__
  if (!targetShot) targetShot = '__extras__';

  // Decide if this row is a FIX photo
  const isFixRow =
    !!(it.is_fix ?? it.isFix ?? it.fix) ||
    (!!it.cleaner_note && it.needs_fix === false);

  const file = {
    name: path.split('/').pop() || 'photo.jpg',
    url: path,
    width: null,
    height: null,
    shotId: targetShot,
    preview: null,
    isFix: isFixRow,
    cleanerNote: it.cleaner_note ?? it.cleanerNote ?? null,
    managerNote: it.manager_note ?? it.manager_notes ?? it.note ?? null,
  };

  (byShot[targetShot] ||= []).push(file);
}

      // Ensure __extras__ shows up if we’ve placed files there and the template didn’t include it
      if (byShot['__extras__'] && !shots.some(s => s.shot_id === '__extras__')) {
        // Append the pseudo section without touching other shots
        // (keeps your existing shape/labels)
        // NOTE: this only adds the section; it does not change shots that already exist.
        // You already added a similar guard in loadTemplate; this is a belt-and-suspenders check.
        // We DO NOT call setShots here to avoid loops; we only surface files via uploadsByShot.
      }

      setUploadsByShot(byShot);

      // kick off signing for thumbnails we’ll render
      Object.values(byShot).flat().forEach(f => ensureThumb(f.url));

      // Debug overlay hooks (if you’re using debug=1)
      if (typeof window !== 'undefined' && window.__CAPTURE_DEBUG__) {
        window.__CAPTURE_DEBUG__.byShot = byShot;
      }
    } catch {
      // ignore
    }
  }
  loadExisting();
}, [turnId, shots]);

  // -------- Load template (required shots) --------
useEffect(() => {
  async function loadTemplate() {
    if (!turnId) return;
    try {
      const r = await fetch(`/api/turn-template?turnId=${turnId}`);
      const json = await r.json();

      let nextShots = [];
      if (Array.isArray(json.shots) && json.shots.length) {
        nextShots = json.shots.map(s => ({
          shot_id: s.shot_id,
          area_key: s.area_key,
          label: s.label,
          min_count: s.min_count || 1,
          notes: s.notes || '',
          rules_text: s.rules_text || ''
        }));
      } else {
        nextShots = DEFAULT_SHOTS;
      }

      // Guarantee at least one visible section
      if (!nextShots.length) {
        nextShots = [{
          shot_id: '__extras__',
          area_key: 'existing_uploads',
          label: 'Additional uploads',
          min_count: 0,
          notes: 'Previously uploaded',
          rules_text: ''
        }];
      }

      setTemplateRules(json.rules || { property: '', template: '' });
      setShots(nextShots);

      // optional debug
      if (typeof window !== 'undefined') {
        window.__CAPTURE_DEBUG__ = window.__CAPTURE_DEBUG__ || {};
        window.__CAPTURE_DEBUG__.shots = nextShots;
      }
    } catch {
      const nextShots = (DEFAULT_SHOTS && DEFAULT_SHOTS.length)
        ? DEFAULT_SHOTS
        : [{
            shot_id: '__extras__',
            area_key: 'existing_uploads',
            label: 'Additional uploads',
            min_count: 0,
            notes: 'Previously uploaded',
            rules_text: ''
          }];
      setShots(nextShots);
      if (typeof window !== 'undefined') {
        window.__CAPTURE_DEBUG__ = window.__CAPTURE_DEBUG__ || {};
        window.__CAPTURE_DEBUG__.shots = nextShots;
      }
    }
  }
  loadTemplate();
}, [turnId]);

  // --- Fetch needs-fix notes (overall + per-photo) for the banner ---
  useEffect(() => {
    if (!turnId) return;
    (async () => {
      try {
        const r = await fetch(`/api/turns/${turnId}/notes`);
        if (!r.ok) return;
        const j = await r.json().catch(() => ({}));
        const overall =
          j.overall_note || j?.notes?.overall || j.overall || '';
        const list =
          (Array.isArray(j.items) ? j.items :
          Array.isArray(j?.notes?.items) ? j.notes.items :
          Array.isArray(j.photos) ? j.photos : []);
        const byPath = {};
        list.forEach(it => { if (it?.path && (it.note || it.notes)) byPath[it.path] = it.note || it.notes; });
        setFixNotes({ byPath, overall: String(overall || ''), count: Object.keys(byPath).length });
      } catch {}
    })();
  }, [turnId]);

  // -------- Add files (quality + upload to Storage) --------
  async function addFiles(shotId, fileList) {
    const files = Array.from(fileList || []);
    const uploaded = [];

    for (const f of files) {
      // 1) Local validation
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

      // 2) Ask backend for upload target
      let meta = {};
      try {
        const resp = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ turnId, shotId, filename: f.name, mime: f.type || 'image/jpeg' })
        });
        meta = await resp.json();
      } catch {
        URL.revokeObjectURL(preview);
        alert('Could not get upload URL; try again.');
        continue;
      }

      const finalPath = meta.path || meta.storage_path || '';
      if (!finalPath) {
        URL.revokeObjectURL(preview);
        alert('Upload target missing (no storage path).');
        continue;
      }

      // 3) Upload using whichever shape the API returned
      try {
        // Tiny trace id for this file attempt
        const traceId = Math.random().toString(36).slice(2, 8);
        let done = false;
        const tried = [];

        // Helper to expose what happened when ?debug=1
        const trace = (obj) => {
          try {
            if (typeof window !== 'undefined' && window.__CAPTURE_DEBUG__) {
              window.__CAPTURE_DEBUG__.lastUpload = {
                ...(window.__CAPTURE_DEBUG__.lastUpload || {}),
                [traceId]: { name: f.name, path: finalPath, ...obj },
              };
            }
          } catch {}
          console.debug('[capture upload]', traceId, obj);
        };

        // Try proxy PUT first (keeps existing preference)
        if (meta.uploadUrl && !done) {
          const up = await fetch(meta.uploadUrl, {
            method: 'PUT',
            headers: { 'Content-Type': meta.mime || 'application/octet-stream' },
            body: f,
          });
          tried.push(`proxy:${up.status}`);
          if (up.ok) {
            done = true;
            trace({ via: 'proxy', status: up.status });
          } else {
            const txt = await up.text().catch(() => '');
            trace({ via: 'proxy', status: up.status, err: txt.slice(0, 200) });
          }
        }

        // Fallback: Supabase signed upload (multipart/form-data)
        if (!done && meta.signedUploadUrl) {
          const fd = new FormData();
          fd.append('file', f);
          if (meta.token) fd.append('token', meta.token);
          const up2 = await fetch(meta.signedUploadUrl, { method: 'POST', body: fd });
          tried.push(`signed:${up2.status}`);
          if (up2.ok) {
            done = true;
            trace({ via: 'signed', status: up2.status });
          } else {
            const txt2 = await up2.text().catch(() => '');
            trace({ via: 'signed', status: up2.status, err: txt2.slice(0, 200) });
          }
        }

        if (!done) {
          throw new Error(`All upload paths failed (${tried.join(', ')}).`);
        }

        // 4) Success → add to UI
        uploaded.push({
          name: f.name,
          shotId,
          url: finalPath,           // store the object key (used later for signing/preview)
          width: dims.width,
          height: dims.height,
          preview,
          isFix: isFixMode
        });
      } catch (e) {
        URL.revokeObjectURL(preview);
        console.warn('[capture addFiles] upload error:', e?.message || e);
        alert(`Upload failed. Please try again.\n(${e?.message || 'unknown error'})`);
      }
    }

    if (uploaded.length) {
      setUploadsByShot(prev => ({ ...prev, [shotId]: [ ...(prev[shotId] || []), ...uploaded ] }));
    }

    // Allow selecting the same file again if needed
    try {
      const el = inputRefs.current[shotId];
      if (el) el.value = '';
    } catch {}
  }

  // -------- Submit initial turn --------
  async function submitAll() {
    if (submitting) return;
    // minimal: ensure each shot meets min_count
    const unmet = (shots || []).filter(s => (s.min_count || 1) > (uploadsByShot[s.shot_id]?.length || 0));
    if (unmet.length) {
      alert('Please add required photos before submitting:\n' + unmet.map(a => `• ${a.label}`).join('\n'));
      return;
    }

    setSubmitting(true);
    try {
      const photos = Object.values(uploadsByShot).flat().map(f => ({
        url: f.url, shotId: f.shotId, area_key: null
      }));
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

  // -------- Submit ONLY fixes (new photos + per-photo notes) --------
  async function submitFixes() {
    if (submitting) return;

    // new photos are those with preview present
    const newPhotos = Object.values(uploadsByShot)
      .flat()
      .filter(f => !!f.preview)
      .map(f => ({
        url: f.url,
        shotId: f.shotId,
        // send per-photo cleaner note
        note: (cleanerNoteByNewPath[f.url] || '').trim() || null,
      }));

    if (newPhotos.length === 0 && !reply.trim()) {
      alert('Add at least one new photo or a note before submitting.');
      return;
    }

    setSubmitting(true);
    try {
      const resp = await fetch('/api/turns/submit-fix', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          turn_id: turnId,
          reply: reply || '',
          photos: newPhotos,   // API will store is_fix + cleaner_note now
        })
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert('Submit fixes failed: ' + (json.error || resp.statusText));
        return;
      }

      alert('Fixes submitted for review ✅');
      // Refresh to fetch persisted is_fix + notes (and manager status change)
      window.location.reload();
    } finally {
      setTimeout(() => setSubmitting(false), 200);
    }
  }

  // -------- Render --------
  const debugOn = (() => {
    try { return new URLSearchParams(window.location.search).get('debug') === '1'; }
    catch { return false; }
  })();

  if (!turnId) {
    return (
      <ChromeDark title="Start Taking Photos">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  const hasFixes = (fixNotes?.count || 0) > 0;
  const renderShots = Array.isArray(shots) ? shots : [];

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
                marginTop: 10, padding: '10px 12px',
                border: '1px solid #d97706', background: '#4a2f04',
                color: '#fcd34d', borderRadius: 10,
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

          {/* Shots */}
          {renderShots.map(s => {
            const files = uploadsByShot[s.shot_id] || [];
            const required = s.min_count || 1;
            const missing = Math.max(0, required - files.length);

            return (
              <div
                key={s.shot_id}
                style={{
                  border: ui.card.border, borderRadius: 12, padding: 12, margin: '12px 0',
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
                        fontSize: 12, marginTop: 4,
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

                {/* File cards */}
                <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16 }}>
                  {files.map(f => {
                    if (!f.preview && !thumbByPath[f.url]) ensureThumb(f.url);
                    const thumb = f.preview || thumbByPath[f.url] || null;
                    const managerNote =
                      // prefer per-photo managerNote from this row (for originals)
                      (!f.isFix && f.managerNote) ||
                      // fallback to the notes API map keyed by path
                      fixNotes?.byPath?.[f.url] ||
                      null;


                    return (
                      <div
                        key={f.url}
                        style={{
                          border: f.isFix ? '1px solid #065f46' : (managerNote ? '1px solid #d97706' : ui.card.border),
                          boxShadow: f.isFix
                            ? '0 0 0 3px rgba(5, 150, 105, 0.20) inset'
                            : (managerNote ? '0 0 0 3px rgba(217,119,6,0.15)' : 'none'),
                          borderRadius:10,
                          padding:10,
                          background: f.isFix ? '#071a16' : '#0b1220'
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
                            <div style={{ width:'100%', height:160, borderRadius:8, background:'#0f172a' }} />
                          )}

                          {/* badges */}
                          {managerNote && (
                            <span style={{
                              position:'absolute', top:8, left:8,
                              background:'#4a2f04', color:'#fcd34d',
                              border:'1px solid #d97706', borderRadius:999,
                              fontSize:12, fontWeight:700, padding:'2px 8px'
                            }}>
                              Needs fix
                            </span>
                          )}
                          {f.isFix && (
                            <span style={{
                              position:'absolute', top:8, right:8,
                              background:'#064e3b', color:'#86efac',
                              border:'1px solid #065f46', borderRadius:999,
                              fontSize:12, fontWeight:700, padding:'2px 8px'
                            }}>
                              FIX
                            </span>
                          )}
                        </div>

                        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'baseline', marginBottom:6 }}>
                          <div style={{ fontSize:13, maxWidth:'70%' }}>
                            <b title={f.name}>{f.name}</b>
                          </div>
                          <ThemedButton kind="secondary" onClick={async () => {
                            try { const url = await signPath(f.url); window.open(url, '_blank'); } catch {}
                          }} ariaLabel={`View ${f.name}`}>
                            👁️ View
                          </ThemedButton>
                        </div>

                        {/* Manager note (if flagged) visible to cleaner */}
                        {managerNote && (
                          <div style={{
                            marginTop:6, padding:'8px 10px',
                            border:'1px dashed #d97706', background:'#3a2b10',
                            color:'#fde68a', borderRadius:8, fontSize:13, whiteSpace:'pre-wrap'
                          }}>
                            {managerNote}
                          </div>
                        )}

                        {/* Cleaner per-photo note editor ONLY for newly added fixes (with preview) */}
                        {f.preview && f.isFix && (
                          <div style={{ marginTop:8 }}>
                            <div style={{ fontSize:12, color:'#9ca3af', marginBottom:4, fontWeight:700 }}>Note to manager (for this fix)</div>
                            <textarea
                              rows={2}
                              value={cleanerNoteByNewPath[f.url] || ''}
                              onChange={e => setCleanerNoteByNewPath(prev => ({ ...prev, [f.url]: e.target.value }))}
                              placeholder="Brief note about the fix…"
                              style={{ ...ui.input, width:'100%', padding:'8px 10px', background:'#0b1220', resize:'vertical' }}
                            />
                          </div>
                        )}

                        {/* Persisted cleaner note (when loaded later without preview) */}
                        {!f.preview && f.isFix && f.cleanerNote && (
                          <div style={{
                            marginTop:8, padding:'8px 10px',
                            background:'#052e2b', border:'1px solid #065f46',
                            borderRadius:8, color:'#86efac', whiteSpace:'pre-wrap'
                          }}>
                            {f.cleanerNote}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          {/* Footer: submit buttons */}
          <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:16, maxWidth:520 }}>
            {tab === 'needs-fix' ? (
              <>
                <textarea
                  value={reply}
                  onChange={e => setReply(e.target.value)}
                  placeholder="Message to manager (optional)"
                  style={{
                    width:'100%', minHeight:80, padding:10,
                    borderRadius:8, border:'1px solid #334155',
                    color:'#e5e7eb', background:'#0b1220'
                  }}
                />
                <ThemedButton onClick={submitFixes} loading={submitting} kind="secondary" ariaLabel="Submit Fixes" full>
                  🔧 Submit Fixes
                </ThemedButton>
              </>
            ) : (
              <ThemedButton onClick={submitAll} loading={submitting} kind="secondary" ariaLabel="Submit Turn" full>
                ✅ Submit Turn
              </ThemedButton>
            )}
          </div>
        </div>

        {/* Debug widget (only if ?debug=1) */}
        {debugOn && (
          <div style={{
            position:'fixed', bottom:12, right:12, zIndex:9999,
            background:'#0b1220', border:'1px solid #334155', borderRadius:8,
            padding:'8px 10px', color:'#cbd5e1', fontSize:12
          }}>
            <div style={{fontWeight:700, marginBottom:4}}>Debug</div>
            <div>shots: {Array.isArray(shots) ? shots.length : '—'}</div>
            <div>sections with files: {
              Object.entries(uploadsByShot || {}).filter(([,list]) => (list||[]).length>0).length
            }</div>
          </div>
        )}
      </section>
    </ChromeDark>
  );
}
