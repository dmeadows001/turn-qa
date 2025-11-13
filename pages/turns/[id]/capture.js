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

  // Guard: define isFixMode for banners/badges and upload variant
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
  const [fixNotes, setFixNotes] = useState({
    byPath: {},
    byShotId: {},
    fixPaths: {},
    overall: '',
    count: 0
  });
  const [hideFixBanner, setHideFixBanner] = useState(false);

  // Cleaner overall reply (optional)
  const [reply, setReply] = useState('');

  // Per-new-photo cleaner notes (keyed by storage path)
  const [cleanerNoteByNewPath, setCleanerNoteByNewPath] = useState({});

  // --- AI pre-check + scan state ---
  const [precheckBusy, setPrecheckBusy] = useState(false);
  const [precheckFlags, setPrecheckFlags] = useState([]);

  const [scanBusy, setScanBusy] = useState(false);
  const [scanFindings, setScanFindings] = useState([]);
  const [scanMarked, setScanMarked] = useState(false);

  // One hidden file input per shot
  const inputRefs = useRef({});

  // ------- helpers -------
  const smallMeta = { fontSize: 12, color: '#94a3b8' };

  // Find manager note for a storage path with simple tolerant checks + shot_id fallback
  function managerNoteFor(path, shotId) {
    try {
      const byPath   = (fixNotes && fixNotes.byPath)   ? fixNotes.byPath   : {};
      const byShotId = (fixNotes && fixNotes.byShotId) ? fixNotes.byShotId : {};
      const p = String(path || '');
      const noLead = p.replace(/^\/+/, '');
      const withLead = p.startsWith('/') ? p : `/${p}`;

      if (byPath[p]) return byPath[p];
      if (byPath[noLead]) return byPath[noLead];
      if (byPath[withLead]) return byPath[withLead];

      // Last resort: match by filename within the same turn folder
      const base = noLead.split('/').pop() || '';
      if (base) {
        const baseLc = base.toLowerCase();
        for (const k of Object.keys(byPath)) {
          const tail = (String(k || '').split('?')[0].split('#')[0].split('/').pop() || '');
          if (tail === base || tail.toLowerCase() === baseLc) return byPath[k];
        }
      }

      if (shotId && byShotId[String(shotId)]) return byShotId[String(shotId)];
      return null;
    } catch {
      return null;
    }
  }

  if (typeof window !== 'undefined') {
    window.__CAPTURE_DEBUG__ = window.__CAPTURE_DEBUG__ || {};
    window.__CAPTURE_DEBUG__.managerNoteFor = managerNoteFor;
  }

  // signs an existing storage path for viewing/thumbnail
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

  // Image dimension helper (safe if load fails)
  async function getDims(file) {
    return new Promise((resolve) => {
      try {
        const img = new Image();
        img.onload = () => {
          const dims = { width: img.naturalWidth || 0, height: img.naturalHeight || 0 };
          URL.revokeObjectURL(img.src);
          resolve(dims);
        };
        img.onerror = () => resolve({ width: 0, height: 0 });
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

  // Map shot_id -> { area_key, label, notes }
  function shotMetaById() {
    const list = Array.isArray(shots) ? shots : [];
    const map = {};
    for (const s of list) map[s.shot_id] = { area_key: s.area_key, label: s.label, notes: s.notes };
    return map;
  }

  function buildUploadsByArea() {
    const meta = shotMetaById();
    const byArea = {};
    for (const [shotId, files = []] of Object.entries(uploadsByShot || {})) {
      const area = (meta[shotId]?.area_key || 'unknown').toString();
      if (!byArea[area]) byArea[area] = [];
      for (const f of files) {
        byArea[area].push({ name: f.name || f.url?.split('/').pop() || 'photo.jpg', url: f.url });
      }
    }
    return byArea;
  }

  function buildScanItems() {
    const meta = shotMetaById();
    const items = [];
    for (const [shotId, files = []] of Object.entries(uploadsByShot || {})) {
      const m = meta[shotId] || {};
      for (const f of files) {
        items.push({
          url: f.url,
          area_key: m.area_key || 'unknown',
          label: m.label || '',
          notes: m.notes || ''
        });
      }
    }
    return items;
  }

  // --- Actions: AI Pre-check ---
  async function runPrecheck() {
    try {
      setPrecheckBusy(true);
      setPrecheckFlags([]);
      const uploadsByArea = buildUploadsByArea();
      const required = (Array.isArray(shots) ? shots : []).map(s => ({
        key: s.area_key,
        title: s.label,
        minPhotos: s.min_count || 1,
      }));
      const r = await fetch('/api/vision-precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ uploadsByArea, required }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'pre-check failed');
      const flags = Array.isArray(j.flags) ? j.flags : (Array.isArray(j?.results) ? j.results : []);
      setPrecheckFlags(flags || []);
    } catch (e) {
      alert('Pre-check failed. ' + (e?.message || ''));
    } finally {
      setPrecheckBusy(false);
    }
  }

  // --- Actions: AI Vision Scan ---
  async function runScan() {
    try {
      setScanBusy(true);
      setScanFindings([]);
      const items = buildScanItems();
      if (!items.length) {
        alert('Please add at least one photo first.');
        return;
      }
      const r = await fetch('/api/vision-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'scan failed');
      const results = Array.isArray(j.results) ? j.results : [];
      setScanFindings(results);
      try {
        if (turnId) {
          const rr = await fetch(`/api/turns/${turnId}/scan-done`, { method: 'POST' });
          if (rr.ok) setScanMarked(true);
        }
      } catch {}
    } catch (e) {
      alert('Vision scan failed. ' + (e?.message || ''));
    } finally {
      setScanBusy(false);
    }
  }

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

  // --- Load existing photos for this turn ---
  useEffect(() => {
    async function loadExisting() {
      if (!turnId) return;

      try {
        const r = await fetch(`/api/list-turn-photos?id=${turnId}`);
        const j = await r.json();
        const items = Array.isArray(j.photos) ? j.photos : [];

        const shotList = Array.isArray(shots) ? shots : [];
        const shotIdSet = new Set(shotList.map(s => s.shot_id));
        const areaToShotId = new Map(
          shotList.map(s => [String(s.area_key || '').toLowerCase(), s.shot_id])
        );

        const byShot = {};
        const seen = new Set();

        for (const it of items) {
  const path = it.path || '';
  const base = path.split('/').pop() || '';

  // Infer whether this is a FIX photo even if is_fix is null / missing
  const inferredFix =
    !!it.is_fix ||
    !!it.cleaner_note ||          // any cleaner note = fix photo
    /__fix__/i.test(base) ||      // our new naming convention
    /-fix\./i.test(base);         // or a “-fix.jpg” style name

  // Dedupe by (path + inferredFix) so original and fix can coexist
  const key = path ? `${path}|${inferredFix ? 1 : 0}` : '';
  if (!path || seen.has(key)) continue;
  seen.add(key);

  let targetShot = null;
  if (it.shot_id && shotIdSet.has(it.shot_id)) {
    targetShot = it.shot_id;
  } else {
    const ak = String(it.area_key || '').toLowerCase();
    if (ak && areaToShotId.has(ak)) targetShot = areaToShotId.get(ak);
  }
  if (!targetShot) targetShot = '__extras__';

  const file = {
    id: it.id ?? null,            // carry DB id through for stable React keys
    name: base || 'photo.jpg',
    url: path,
    width: null,
    height: null,
    shotId: targetShot,
    preview: null,
    isFix: inferredFix,           // <-- drives green outline + FIX badge
    cleanerNote: it.cleaner_note || null,
  };

  (byShot[targetShot] ||= []).push(file);
}

        if (byShot['__extras__'] && !shotList.some(s => s.shot_id === '__extras__')) {
          setShots(prev => {
            const cur = Array.isArray(prev) ? prev : [];
            if (cur.some(s => s.shot_id === '__extras__')) return cur;
            return [
              ...cur,
              {
                shot_id: '__extras__',
                area_key: 'existing_uploads',
                label: 'Additional uploads',
                min_count: 0,
                notes: 'Previously uploaded',
                rules_text: ''
              }
            ];
          });
        }

        setUploadsByShot(prev => {
          const merged = { ...byShot };
          // Keep any new (unsaved) fix uploads already in state
          for (const [shotId, localFiles = []] of Object.entries(prev || {})) {
            const previews = localFiles.filter(f => f.preview);
            if (previews.length) merged[shotId] = [ ...(merged[shotId] || []), ...previews ];
          }
          return merged;
        });

        if (typeof window !== 'undefined') {
          window.__CAPTURE_DEBUG__ = window.__CAPTURE_DEBUG__ || {};
          window.__CAPTURE_DEBUG__.byShot = byShot;
        }
      } catch {
        // ignore
      }
    }
    loadExisting();
  }, [turnId, shots]);

   // --- Fetch needs-fix notes + map originals and fixes ---
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
        const byShotId = {};
        const fixPaths = {};

        // helper to index an original photo path for "Needs fix"
        const indexPath = (path, note) => {
          if (!path) return;
          const raw      = String(path);
          const noLead   = raw.replace(/^\/+/, '');
          const withLead = raw.startsWith('/') ? raw : `/${raw}`;
          byPath[raw] = note;
          byPath[noLead] = note;
          byPath[withLead] = note;
        };

        for (const it of list) {
          const note = it?.note || it?.notes;
          if (!note) continue;

          // ORIGINAL photo path—that's where we show the amber "Needs fix"
          const origRaw =
            it.original_path || it.orig_path ||
            it.original_url  || it.orig_url  ||
            it.path || '';

          // FIX photo path (if the API sends a separate one)
          const fixRaw =
            it.fix_path || it.fixed_path || null;

          indexPath(origRaw, note);

          if (it.shot_id) {
            byShotId[String(it.shot_id)] = note;
          }
          const origShot =
            it.orig_shotid || it.orig_shot_id ||
            it.original_shotid || it.original_shot_id;
          if (origShot) {
            byShotId[String(origShot)] = note;
          }

          // Only mark FIX paths when we have an explicit fix_path
          if (fixRaw) {
            const rawF      = String(fixRaw);
            const noLeadF   = rawF.replace(/^\/+/, '');
            const withLeadF = rawF.startsWith('/') ? rawF : `/${rawF}`;
            fixPaths[rawF] = true;
            fixPaths[noLeadF] = true;
            fixPaths[withLeadF] = true;
          }
        }

        const count =
          Object.keys(byPath).length > 0
            ? Object.keys(byPath).length
            : Object.keys(byShotId).length;

        setFixNotes({
          byPath,
          byShotId,
          fixPaths,
          overall: String(overall || ''),
          count
        });

        // debug expose
        if (typeof window !== 'undefined') {
          window.__CAPTURE_DEBUG__ = window.__CAPTURE_DEBUG__ || {};
          window.__CAPTURE_DEBUG__.fixNotes = {
            byPath,
            byShotId,
            fixPaths,
            overall: String(overall || ''),
            count
          };
        }
      } catch {
        // ignore
      }
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
        // Unique name for fix uploads so we never reuse original key
        const filenameForUpload = (() => {
          if (!isFixMode) return f.name;
          const dot = f.name.lastIndexOf('.');
          const base = dot > 0 ? f.name.slice(0, dot) : f.name;
          const ext  = dot > 0 ? f.name.slice(dot) : '';
          return `${base}__fix__${Date.now().toString(36)}${ext}`;
        })();

        const resp = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            turnId,
            shotId,
            filename: filenameForUpload,
            mime: f.type || 'image/jpeg',
            variant: isFixMode ? 'fix' : undefined
          })
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
        const traceId = Math.random().toString(36).slice(2, 8);
        let done = false;
        const tried = [];

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
          id: null,
          name: f.name,
          shotId,
          url: finalPath,           // object key (used later for signing/preview)
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

    try {
      const el = inputRefs.current[shotId];
      if (el) el.value = '';
    } catch {}
  }

  // -------- Submit initial turn --------
  async function submitAll() {
    if (submitting) return;
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
      const json = await resp.json().catch(() => ({}));

      if (resp.status === 409 && json.code === 'SCAN_REQUIRED') {
        alert('Please run AI Scan before submitting this turn.');
        try { document.getElementById('scan')?.scrollIntoView({ behavior: 'smooth' }); } catch {}
        return;
      }

      if (!resp.ok) {
        alert('Submit failed: ' + (json.error || resp.statusText));
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

    const newPhotos = Object.values(uploadsByShot)
      .flat()
      .filter(f => !!f.preview)
      .map(f => ({
        url: f.url,
        shotId: f.shotId,
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
          photos: newPhotos,
        })
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert('Submit fixes failed: ' + (json.error || resp.statusText));
        return;
      }

      alert('Fixes submitted for review ✅');
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

          {/* AI helper actions (only for first-time capture, not during needs-fix) */}
          {tab !== 'needs-fix' && (
            <div
              id="scan"
              style={{
                margin:'8px 0 12px',
                padding:'10px 12px',
                border:'1px solid #2563eb',
                background:'#0b1736',
                borderRadius:10,
                display:'grid',
                gap:10
              }}
            >
              <div style={{ display:'flex', gap:8, flexWrap:'wrap', alignItems:'center' }}>
                <button
                  type="button"
                  onClick={runPrecheck}
                  disabled={precheckBusy}
                  style={{ ...ui.btnPrimary, opacity: precheckBusy ? 0.75 : 1 }}
                >
                  {precheckBusy ? 'Checking…' : 'AI Pre-check'}
                </button>

                <button
                  type="button"
                  onClick={runScan}
                  disabled={scanBusy}
                  style={{ ...ui.btnSecondary, opacity: scanBusy ? 0.75 : 1 }}
                >
                  {scanBusy ? 'Scanning…' : 'AI Scan'}
                </button>

                {scanMarked && (
                  <span
                    aria-live="polite"
                    style={{
                      fontSize:12, padding:'4px 8px', borderRadius:999,
                      border:'1px solid #065f46', background:'#052e2b', color:'#86efac'
                    }}
                  >
                    ✓ Scan complete
                  </span>
                )}
              </div>

              {!!precheckFlags.length && (
                <div style={{ fontSize:13, color:'#bfdbfe' }}>
                  <div style={{ fontWeight:700, marginBottom:4 }}>Pre-check:</div>
                  <ul style={{ margin:'6px 0 0 18px' }}>
                    {precheckFlags.map((t, i) => (<li key={i}>{t}</li>))}
                  </ul>
                </div>
              )}

              {!!scanFindings.length && (
                <div style={{ fontSize:13, color:'#bfdbfe' }}>
                  <div style={{ fontWeight:700, marginBottom:4 }}>Vision findings:</div>
                  <ul style={{ margin:'6px 0 0 18px' }}>
                    {scanFindings.flatMap((r, i) => {
                      const issues = Array.isArray(r.issues) ? r.issues : [];
                      if (!issues.length) return [];
                      const area = r.area_key || 'unknown';
                      return issues.map((iss, j) => (
                        <li key={`${i}:${j}`}>
                          [{area}] {iss.label || 'Issue'}{iss.severity ? ` • ${iss.severity}` : ''}
                          {typeof iss.confidence === 'number' ? ` (${Math.round(iss.confidence*100)}%)` : ''}
                        </li>
                      ));
                    })}
                  </ul>
                </div>
              )}
            </div>
          )}

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

                {/* Placeholder */}
                {files.length === 0 && (
                  <div
                    onClick={() => openPicker(s.shot_id)}
                    role="button"
                    aria-label={`Add first photo for ${s.label}`}
                    style={{
                      marginTop:10,
                      border:'1px dashed #4977f6',
                      background:'#0b1220',
                      borderRadius:10,
                      height:120,
                      display:'flex',
                      alignItems:'center',
                      justifyContent:'center',
                      cursor:'pointer',
                      userSelect:'none'
                    }}
                  >
                    <div style={{ textAlign:'center', color:'#93c5fd' }}>
                      <div style={{ fontSize:28, lineHeight:1 }}>＋</div>
                      <div style={{ fontSize:12 }}>Tap to add photo</div>
                    </div>
                  </div>
                )}

                {/* File cards */}
                <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(260px,1fr))', gap:16 }}>
                  {files.map(f => {
  if (!f.preview && !thumbByPath[f.url]) ensureThumb(f.url);
  const thumb = f.preview || thumbByPath[f.url] || null;
  const managerNote = managerNoteFor(f.url, f.shotId || s.shot_id);

  // Only originals show amber "Needs fix"
  const showNeedsFix = !!managerNote && !f.isFix;

  // Make sure original + fix with same path both render
  const reactKey =
    f.id != null
      ? `row-${f.id}`
      : `${f.url}|${f.isFix ? 'fix' : 'orig'}`;

  return (
    <div
      key={reactKey}
      style={{
        border: f.isFix ? '1px solid #065f46' : (showNeedsFix ? '1px solid #d97706' : ui.card.border),
        boxShadow: f.isFix
          ? '0 0 0 3px rgba(5, 150, 105, 0.20) inset'
          : (showNeedsFix ? '0 0 0 3px rgba(217,119,6,0.15)' : 'none'),
        borderRadius:10,
        padding:10,
        background: f.isFix ? '#071a16' : '#0b1220'
      }}
    >
      {/* rest of card unchanged */}
    </div>
  );
})}

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
                          {showNeedsFix && (
                            <span style={{
                              position:'absolute', top:8, left:8,
                              background:'#4a2f04', color:'#fcd34d',
                              border:'1px solid #d97706', borderRadius:999,
                              fontSize:12, fontWeight:700, padding:'2px 8px'
                            }}>
                              Needs fix
                            </span>
                          )}
                          {isFixFlag && (
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

                        {/* Manager note (only on originals) */}
                        {showNeedsFix && (
                          <div style={{
                            marginTop:6, padding:'8px 10px',
                            border:'1px dashed #d97706', background:'#3a2b10',
                            color:'#fde68a', borderRadius:8, fontSize:13, whiteSpace:'pre-wrap'
                          }}>
                            {managerNote}
                          </div>
                        )}

                        {/* Cleaner per-photo note editor ONLY for newly added fixes (with preview) */}
                        {f.preview && isFixFlag && (
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
                        {!f.preview && isFixFlag && f.cleanerNote && (
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
