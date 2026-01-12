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

    // -------- Getting Started modal (Cleaner) --------
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  // Different keys for capture vs needs-fix so we can show different instructions
  const gettingStartedKey = (() => {
    const t = String(tab || '').toLowerCase();
    if (t === 'needs-fix' || t === 'needs_fix' || t === 'fix') return 'turnqa_gs_cleaner_needsfix_v1';
    return 'turnqa_gs_cleaner_capture_v1';
  })();

  function safeGetLS(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function safeSetLS(key, val) {
    try { window.localStorage.setItem(key, val); } catch {}
  }


  // Signed thumbnail cache for existing/new photos
  const [thumbByPath, setThumbByPath] = useState({});
  const requestedThumbsRef = useRef(new Set());

  // Lightbox state for reference photos
  const [refLightbox, setRefLightbox] = useState({
    open: false,
    urls: [],
    index: 0,
  });

  // Needs-fix (manager) notes to show to cleaner, by storage path
  const [fixNotes, setFixNotes] = useState({ byPath: {}, overall: '', count: 0 });
  const [hideFixBanner, setHideFixBanner] = useState(false);

  // Cleaner overall reply (optional) — bilingual (ES original + EN translated)
  const [replyOriginal, setReplyOriginal] = useState('');
  const [replyTranslated, setReplyTranslated] = useState('');
  const [isTranslatingReply, setIsTranslatingReply] = useState(false);
  const [translateReplyError, setTranslateReplyError] = useState('');

  // Per-new-photo cleaner notes (keyed by storage path)
  // shape: { [path]: { original: string, translated: string, isTranslating?: boolean, error?: string } }
  const [cleanerNoteByNewPath, setCleanerNoteByNewPath] = useState({});

  // --- AI scan state ---
  // scanStatus: 'idle' | 'running' | 'ready'
  const [scanStatus, setScanStatus] = useState('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [scanIssues, setScanIssues] = useState([]); // array of strings (summary list)
  const [scanProgress, setScanProgress] = useState(0); // 0–100 while scanning
  const [scanIssuesByArea, setScanIssuesByArea] = useState({}); // { areaKey: [msg, ...] }

  // --- NEW: bottom-sheet picker state for cleaner photo uploads ---
  const [pickerShot, setPickerShot] = useState(null);      // which shot_id is currently picking
  const [pickerVisible, setPickerVisible] = useState(false);
  const cameraInputRef = useRef(null);
  const fileInputRef = useRef(null); // generic "choose from device"

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

  // Open a signed URL in a way that works on mobile (Safari popup rules)
  async function openSignedPath(path) {
    try {
      // Open a blank tab/window synchronously
      const win = window.open('', '_blank');
      if (!win) {
        // Fallback: same tab if popup blocked
        const url = await signPath(path);
        if (url) window.location.href = url;
        return;
      }
      // Now fetch signed URL asynchronously and point the tab at it
      const url = await signPath(path);
      if (!url) {
        win.close();
        return;
      }
      win.location = url;
    } catch (e) {
      console.error('openSignedPath error:', e);
    }
  }

  // Lightbox helpers for reference photos
  async function openRefLightbox(paths, startIndex = 0) {
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!list.length) return;
    try {
      const urls = [];
      for (const p of list) {
        try {
          const u = await signPath(p);
          if (u) urls.push(u);
        } catch {
          // ignore single failure
        }
      }
      if (!urls.length) return;
      setRefLightbox({
        open: true,
        urls,
        index: Math.min(startIndex, urls.length - 1),
      });
    } catch (e) {
      console.error('openRefLightbox error:', e);
    }
  }

  function closeRefLightbox() {
    setRefLightbox(prev => ({ ...prev, open: false }));
  }

  function nextRefLightbox(e) {
    if (e) e.stopPropagation();
    setRefLightbox(prev => {
      if (!prev.urls.length) return prev;
      const nextIndex = (prev.index + 1) % prev.urls.length;
      return { ...prev, index: nextIndex };
    });
  }

  function prevRefLightbox(e) {
    if (e) e.stopPropagation();
    setRefLightbox(prev => {
      if (!prev.urls.length) return prev;
      const nextIndex = (prev.index - 1 + prev.urls.length) % prev.urls.length;
      return { ...prev, index: nextIndex };
    });
  }

  // Keyboard support for the lightbox
  useEffect(() => {
    if (!refLightbox.open) return;
    function onKey(e) {
      if (e.key === 'Escape') {
        closeRefLightbox();
      } else if (e.key === 'ArrowRight') {
        nextRefLightbox();
      } else if (e.key === 'ArrowLeft') {
        prevRefLightbox();
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [refLightbox.open]);

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

  // --- NEW: open custom bottom-sheet picker instead of direct file input ---
  function openPicker(shotId) {
    setPickerShot(shotId);
    setPickerVisible(true);
  }

  // --- NEW: handle file selection from global hidden inputs ---
  function handleGlobalFileChange(e) {
    const files = e.target.files;
    if (files && files.length && pickerShot) {
      addFiles(pickerShot, files);
    }
    // reset input so same file can be re-selected
    try { e.target.value = ''; } catch {}
    setPickerVisible(false);
    setPickerShot(null);
  }

  function closePicker() {
    setPickerVisible(false);
    setPickerShot(null);
  }

  // --- Translate helper for cleaner reply (Spanish -> English) ---
  async function translateReplyToEnglish() {
    setTranslateReplyError('');
    const text = String(replyOriginal || '').trim();
    if (!text) return;

    setIsTranslatingReply(true);
    try {
      const r = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLang: 'en' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Translate failed');

      setReplyTranslated(String(j?.translatedText || '').trim());
    } catch (e) {
      setTranslateReplyError(e?.message || 'Translate failed');
    } finally {
      setIsTranslatingReply(false);
    }
  }

  // --- Translate helper for per-photo note (Spanish -> English) ---
  async function translatePhotoNoteToEnglish(path) {
    if (!path) return;
    const text = String(cleanerNoteByNewPath[path]?.original || '').trim();
    if (!text) return;

    // set loading + clear error
    setCleanerNoteByNewPath(prev => ({
      ...prev,
      [path]: { ...(prev[path] || {}), isTranslating: true, error: '' }
    }));

    try {
      const r = await fetch('/api/translate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, targetLang: 'en' }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j?.error || 'Translate failed');

      setCleanerNoteByNewPath(prev => ({
        ...prev,
        [path]: {
          ...(prev[path] || {}),
          translated: String(j?.translatedText || '').trim(),
          isTranslating: false,
          error: '',
        }
      }));
    } catch (e) {
      setCleanerNoteByNewPath(prev => ({
        ...prev,
        [path]: {
          ...(prev[path] || {}),
          isTranslating: false,
          error: e?.message || 'Translate failed',
        }
      }));
    }
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
            rules_text: s.rules_text || '',
            // NEW: reference listing / staging photos for this shot (optional)
            reference_paths: Array.isArray(s.reference_paths || s.referencePhotos)
              ? (s.reference_paths || s.referencePhotos)
              : []
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

    // Show Getting Started modal (only if user hasn't dismissed it before)
  useEffect(() => {
    if (!turnId) return;
    if (typeof window === 'undefined') return;

    const already = safeGetLS(gettingStartedKey) === '1';
    if (!already) {
      setShowGettingStarted(true);
    }
  }, [turnId, gettingStartedKey]);

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
  }

  // Allow cleaner to "retake" a photo by removing it from this shot
  function removePhoto(shotId, fileToRemove) {
    try {
      if (fileToRemove.preview) {
        URL.revokeObjectURL(fileToRemove.preview);
      }
    } catch {}

    // Remove from uploadsByShot so AI Scan + submit won't see it
    setUploadsByShot(prev => {
      const next = { ...prev };
      next[shotId] = (next[shotId] || []).filter(f => f.url !== fileToRemove.url);
      return next;
    });

    // Also clear any per-photo cleaner note for that path
    setCleanerNoteByNewPath(prev => {
      if (!prev[fileToRemove.url]) return prev;
      const { [fileToRemove.url]: _omit, ...rest } = prev;
      return rest;
    });
  }

  // -------- AI Scan: PRECHECK + VISION + mark scan-done --------
  async function runAiScan() {
    if (!turnId) return;
    if (!Array.isArray(shots) || shots.length === 0) {
      alert('No checklist sections are loaded yet. Please wait a moment and try again.');
      return;
    }

    // Flatten all current photos from uploadsByShot
    const allFiles = [];
    const uploads = uploadsByShot || {};
    const shotsArr = Array.isArray(shots) ? shots : [];

    shotsArr.forEach(s => {
      const files = uploads[s.shot_id] || [];
      files.forEach(f => {
        allFiles.push({ file: f, shot: s });
      });
    });

    if (!allFiles.length) {
      alert('No photos to scan yet. Please add at least one photo first.');
      return;
    }

    setScanStatus('running');
    setScanMessage('Running AI Scan…');
    setScanIssues([]);
    setScanIssuesByArea({});
    setScanProgress(5);

    let progress = 5;
    const timer = setInterval(() => {
      // creep toward 90% while we wait for the backend
      progress = Math.min(progress + Math.random() * 12, 90);
      setScanProgress(progress);
    }, 400);

    try {
      // 1) Build payload for pre-check
      const uploadsByArea = {};
      const requiredList = shotsArr.map(s => ({
        key: s.area_key || s.shot_id,
        title: s.label,
        minPhotos: s.min_count || 1,
      }));

      for (const { file, shot } of allFiles) {
        const key = shot.area_key || shot.shot_id || 'unknown';
        if (!uploadsByArea[key]) uploadsByArea[key] = [];
        uploadsByArea[key].push({
          name: file.name || (file.url ? file.url.split('/').pop() : 'photo'),
        });
      }

      const preResp = await fetch('/api/vision-precheck', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          uploadsByArea,
          required: requiredList,
        }),
      });
      const preJson = await preResp.json().catch(() => ({}));
      const preFlags = Array.isArray(preJson.flags) ? preJson.flags : [];

      // 2) Build payload for vision-scan
      const scanItems = allFiles.map(({ file, shot }) => ({
        url: file.url,
        area_key: shot.area_key || shot.shot_id || 'unknown',
        label: shot.label,
        notes: shot.notes || '',
      }));

      const scanResp = await fetch('/api/vision-scan', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ items: scanItems }),
      });
      const scanJson = await scanResp.json().catch(() => ({}));
      const results = Array.isArray(scanJson.results) ? scanJson.results : [];

      // Build both the flat summary list and a per-area map
      const visionIssues = [];
      const issuesByArea = {};

      for (const r of results) {
        const rawArea = r.area_key || r.area || '';
        const areaLabel = rawArea || 'Area';
        const areaKey = (rawArea || '').toLowerCase() || 'unknown-area';

        const issues = Array.isArray(r.issues) ? r.issues : [];
        if (!issuesByArea[areaKey]) issuesByArea[areaKey] = [];

        for (const issue of issues) {
          if (!issue || !issue.label) continue;
          const sev = issue.severity || 'info';

          // Full message (for summary at bottom)
          const summaryMsg = `${areaLabel}: ${issue.label} (${sev})`;
          visionIssues.push(summaryMsg);

          // Short message for per-area box
          const shortMsg = `${issue.label} (${sev})`;
          issuesByArea[areaKey].push(shortMsg);
        }
      }

      setScanIssuesByArea(issuesByArea);

      const allIssues = [...preFlags, ...visionIssues];

      // 3) Mark scan-done in the DB
      try {
        await fetch(`/api/turns/${encodeURIComponent(turnId)}/scan-done`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ passed: allIssues.length === 0 }),
        });
      } catch (e) {
        console.warn('scan-done failed (non-fatal):', e?.message || e);
      }

      // Finish the progress bar smoothly
      setScanProgress(100);

      const hasVisionIssues = visionIssues.length > 0;

      if (!hasVisionIssues) {
        // No per-photo AI issues → show the happy message
        setScanStatus('ready');
        setScanIssues([]); // no warning bullets needed
        setScanMessage('🎉 Congratulations: AI Scan found no issues.');
      } else {
        // At least one real AI photo issue → show warning + bullets (preFlags + visionIssues)
        setScanStatus('ready');
        setScanIssues(allIssues);
        setScanMessage(
          'WARNING: AI Scan found potential issues. Please see the AI notes above.\n\n' +
          allIssues.map(x => `• ${x}`).join('\n')
        );
      }
    } catch (e) {
      console.error('runAiScan error:', e);
      setScanStatus('idle');
      setScanProgress(0);
      setScanIssuesByArea({});
      setScanMessage('AI Scan failed. You can still submit, but consider trying again if you need the extra check.');
    } finally {
      clearInterval(timer);
    }
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

    // If AI Scan never ran, warn but allow override
    if (scanStatus === 'idle') {
      const cont = window.confirm(
        'AI Scan has not been run for this turn.\n\n' +
        'AI Scan can help catch missing photos or issues before your manager sees them.\n\n' +
        'Click OK to submit anyway, or Cancel to go back and run AI Scan first.'
      );
      if (!cont) return;
    }

    // If AI Scan ran and reported issues, show WARNING confirm
    if (scanIssues.length) {
      const cont = window.confirm(
        'WARNING: AI Scan reported potential issues:\n\n' +
        scanIssues.map(x => `• ${x}`).join('\n') +
        '\n\nClick OK to confirm you have reviewed these and still want to submit.'
      );
      if (!cont) return;
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
      .map(f => {
        const noteObj = cleanerNoteByNewPath[f.url] || {};
        const no = String(noteObj.original || '').trim();     // Spanish
        const nt = String(noteObj.translated || '').trim();   // English

        return {
          url: f.url,
          shotId: f.shotId,

          // manager-facing (English preferred)
          note: (nt || no || '').trim() || null,

          // bilingual fields for history (API stores into turn_photos new columns)
          note_original: no || null,
          note_translated: nt || null,
          note_original_lang: no ? 'es' : null,
          note_translated_lang: nt ? 'en' : null,
        };
      });

    const ro = (replyOriginal || '').trim();      // Spanish original
    const rt = (replyTranslated || '').trim();    // English translated (editable)

    // What gets sent/displayed to the manager
    const replySent = (rt || ro || '').trim();

    if (newPhotos.length === 0 && !replySent) {
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

          // Legacy (manager-facing): prefer English if present
          reply: replySent,

          // New bilingual fields for history
          reply_original: ro || null,
          reply_translated: rt || null,
          reply_original_lang: ro ? 'es' : null,
          reply_translated_lang: rt ? 'en' : null,

          photos: newPhotos,
        })
      });

      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        alert('Submit fixes failed: ' + (json.error || resp.statusText));
        return;
      }

      alert('Fixes submitted for review ✅');
      window.location.href = '/capture';
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
          {/* Getting Started modal (Cleaner) */}
          {showGettingStarted && (
            <div
              style={{
                position: 'fixed',
                inset: 0,
                zIndex: 10050,
                background: 'rgba(0,0,0,0.72)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                padding: 16
              }}
              onClick={() => {
                // click outside closes (same as dismiss, but doesn't persist unless checkbox checked)
                setShowGettingStarted(false);
                if (dontShowAgain) safeSetLS(gettingStartedKey, '1');
              }}
            >
              <div
                onClick={(e) => e.stopPropagation()}
                style={{
                  width: 'min(720px, 100%)',
                  borderRadius: 16,
                  border: '1px solid #334155',
                  background: '#0b1220',
                  boxShadow: '0 20px 80px rgba(0,0,0,0.6)',
                  padding: 16
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center' }}>
                  <div style={{ fontSize: 18, fontWeight: 800, color: '#e5e7eb' }}>
                    Getting Started
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      setShowGettingStarted(false);
                      if (dontShowAgain) safeSetLS(gettingStartedKey, '1');
                    }}
                    style={{
                      ...ui.btnSecondary,
                      padding: '6px 10px',
                      borderRadius: 999,
                      border: '1px solid #334155',
                      background: '#0f172a',
                      color: '#cbd5e1'
                    }}
                  >
                    ✕
                  </button>
                </div>

                {String(tab || '').toLowerCase() === 'needs-fix' ? (
                  <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>You’re in “Needs Fix” mode</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      <li>Look for photos marked <b style={{ color: '#fcd34d' }}>Needs fix</b> (your manager left notes).</li>
                      <li>Tap <b>Add photo</b> and upload a new “FIX” photo for the issue you corrected.</li>
                      <li>Optional: add a note to the manager (Spanish → Translate to English).</li>
                      <li>When you’re done, tap <b>Submit Fixes</b> to send the updates back for review.</li>
                    </ul>
                  </div>
                ) : (
                  <div style={{ marginTop: 12, color: '#cbd5e1', fontSize: 14, lineHeight: 1.5 }}>
                    <div style={{ fontWeight: 800, marginBottom: 6 }}>Capture flow (new turn)</div>
                    <ul style={{ margin: 0, paddingLeft: 18 }}>
                      <li>For each section, tap <b>Add photo</b> and take clear, well-lit pictures.</li>
                      <li>Try to match any <b>reference photos</b> shown (how the area should look).</li>
                      <li>When finished, tap <b>Run AI Scan</b> to catch issues before submitting.</li>
                      <li>Tap <b>Submit Turn</b> when all required photos are uploaded.</li>
                    </ul>
                  </div>
                )}

                <div style={{ marginTop: 14, display: 'flex', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', userSelect: 'none' }}>
                    <input
                      type="checkbox"
                      checked={dontShowAgain}
                      onChange={(e) => setDontShowAgain(!!e.target.checked)}
                      style={{ transform: 'scale(1.1)' }}
                    />
                    <span style={{ color: '#94a3b8', fontSize: 13 }}>Don’t show this again</span>
                  </label>

                  <div style={{ flex: 1 }} />

                  <button
                    type="button"
                    onClick={() => {
                      setShowGettingStarted(false);
                      if (dontShowAgain) safeSetLS(gettingStartedKey, '1');
                    }}
                    style={{
                      ...ui.btnPrimary,
                      padding: '10px 14px',
                      borderRadius: 12
                    }}
                  >
                    Dismiss
                  </button>
                </div>
              </div>
            </div>
          )}

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

            // Normalize area key and label for AI summaries
            const areaKey = String(s.area_key || s.shot_id || '').toLowerCase();
            const areaIssues = scanIssuesByArea[areaKey] || [];
            const areaLabel = s.label || s.area_key || 'This area';
            // Reference listing photos for this shot (optional)
            const referencePaths = Array.isArray(s.reference_paths) ? s.reference_paths : [];

            return (
              <div
                key={s.shot_id}
                style={{
                  border: ui.card.border, borderRadius: 12, padding: 12, margin: '12px 0',
                  background: ui.card.background
                }}
              >
                {/* Reference listing photo(s) for this area */}
                {referencePaths.length > 0 && (
                  <div
                    style={{
                      margin: '4px 0 10px',
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: '1px solid #334155',
                      background: '#020617'
                    }}
                  >
                    <div
                      style={{
                        fontSize: 12,
                        fontWeight: 700,
                        color: '#e5e7eb',
                        marginBottom: 6
                      }}
                    >
                      Reference photo{referencePaths.length > 1 ? 's' : ''} – how this
                      area should look
                    </div>

                    <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                      {referencePaths.map((path) => {
                        if (!thumbByPath[path]) ensureThumb(path);
                        const refThumb = thumbByPath[path] || null;
                        const startIndex = referencePaths.indexOf(path);

                        return (
                          <button
                            key={path}
                            type="button"
                            onClick={() => openRefLightbox(referencePaths, startIndex)}
                            style={{
                              padding: 0,
                              border: 'none',
                              background: 'transparent',
                              cursor: 'pointer'
                            }}
                          >
                            {refThumb ? (
                              <img
                                src={refThumb}
                                alt="Reference"
                                style={{
                                  width: 80,
                                  height: 80,
                                  objectFit: 'cover',
                                  borderRadius: 6,
                                  border: '1px solid #334155'
                                }}
                              />
                            ) : (
                              <div
                                style={{
                                  width: 80,
                                  height: 80,
                                  borderRadius: 6,
                                  border: '1px solid #334155',
                                  background: '#0f172a'
                                }}
                              />
                            )}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                )}

                {/* AI Scan message for this area (once per section) */}
                {scanStatus === 'ready' && (
                  <div
                    style={{
                      marginBottom: 10,
                      padding: '8px 10px',
                      borderRadius: 8,
                      border: areaIssues.length
                        ? '1px solid #d97706'
                        : '1px solid #065f46',
                      background: areaIssues.length
                        ? '#3a2b10'
                        : '#052e2b',
                      color: areaIssues.length
                        ? '#fde68a'
                        : '#bbf7d0',
                      fontSize: 12,
                    }}
                  >
                    <div
                      style={{
                        fontWeight: 700,
                        marginBottom: areaIssues.length ? 4 : 0,
                      }}
                    >
                      {areaIssues.length
                        ? `AI Scan: potential issues in ${areaLabel}`
                        : `AI Scan: ${areaLabel} photos look good ✅`}
                    </div>

                    {areaIssues.length > 0 && (
                      <ul style={{ margin: 0, paddingLeft: 18 }}>
                        {areaIssues.map((msg, idx) => (
                          <li key={idx} style={{ marginBottom: 2 }}>
                            {msg}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

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

                  <ThemedButton
                    kind="secondary"
                    onClick={() => openPicker(s.shot_id)}
                    ariaLabel={`Add photo for ${s.label}`}
                  >
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

                    const perPhoto = cleanerNoteByNewPath[f.url] || {};
                    const perPhotoOriginal = String(perPhoto.original || '');
                    const perPhotoTranslated = String(perPhoto.translated || '');
                    const perPhotoLoading = !!perPhoto.isTranslating;
                    const perPhotoErr = String(perPhoto.error || '');

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

                        <div
                          style={{
                            display:'flex',
                            justifyContent:'space-between',
                            alignItems:'baseline',
                            marginBottom:6
                          }}
                        >
                          <div style={{ fontSize:13, maxWidth:'60%' }}>
                            <b title={f.name}>{f.name}</b>
                          </div>

                          <div style={{ display:'flex', gap:8 }}>
                            <ThemedButton
                              kind="secondary"
                              onClick={() => openSignedPath(f.url)}
                              ariaLabel={`View ${f.name}`}
                            >
                              👁️ View
                            </ThemedButton>
                            <ThemedButton
                              kind="secondary"
                              onClick={() => removePhoto(s.shot_id, f)}
                              ariaLabel={`Retake ${f.name}`}
                            >
                              🔁 Retake
                            </ThemedButton>
                          </div>
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

                        {/* Cleaner per-photo bilingual note editor ONLY for newly added fixes (with preview) */}
                        {f.preview && f.isFix && (
                          <div style={{ marginTop:8 }}>
                            <div style={{ fontSize:12, color:'#9ca3af', marginBottom:4, fontWeight:700 }}>
                              Note to manager (Spanish → translate to English)
                            </div>

                            {/* Original (Spanish) */}
                            <textarea
                              rows={2}
                              value={perPhotoOriginal}
                              onChange={e => {
                                const v = e.target.value;
                                setCleanerNoteByNewPath(prev => ({
                                  ...prev,
                                  [f.url]: { ...(prev[f.url] || {}), original: v }
                                }));
                              }}
                              placeholder="Escribe tu nota en Español…"
                              style={{ ...ui.input, width:'100%', padding:'8px 10px', background:'#0b1220', resize:'vertical' }}
                            />

                            <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:8 }}>
                              <ThemedButton
                                kind="secondary"
                                onClick={() => translatePhotoNoteToEnglish(f.url)}
                                loading={perPhotoLoading}
                                disabled={perPhotoLoading || !String(perPhotoOriginal || '').trim()}
                                ariaLabel="Translate photo note to English"
                              >
                                🌐 Translate to English
                              </ThemedButton>

                              {perPhotoErr ? (
                                <div style={{ fontSize: 12, color: '#fca5a5' }}>{perPhotoErr}</div>
                              ) : null}
                            </div>

                            <div style={{ fontSize:12, color:'#9ca3af', marginTop:10, marginBottom:4, fontWeight:700 }}>
                              Translated (English — manager receives this)
                            </div>

                            {/* Translated (English) */}
                            <textarea
                              rows={2}
                              value={perPhotoTranslated}
                              onChange={e => {
                                const v = e.target.value;
                                setCleanerNoteByNewPath(prev => ({
                                  ...prev,
                                  [f.url]: { ...(prev[f.url] || {}), translated: v }
                                }));
                              }}
                              placeholder="English version will appear here… (editable)"
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

          {/* Footer: AI scan + submit buttons */}
          <div style={{ display:'flex', flexDirection:'column', gap:12, marginTop:16, maxWidth:520 }}>
            {tab === 'needs-fix' ? (
              <>
                <div style={{ fontSize: 12, color: '#9ca3af', marginBottom: 6, fontWeight: 700 }}>
                  Message to manager (Spanish → translate to English)
                </div>

                <textarea
                  value={replyOriginal}
                  onChange={e => setReplyOriginal(e.target.value)}
                  placeholder="Escribe tu mensaje en Español…"
                  style={{
                    width:'100%', minHeight:80, padding:10,
                    borderRadius:8, border:'1px solid #334155',
                    color:'#e5e7eb', background:'#0b1220',
                    resize:'vertical'
                  }}
                />

                <div style={{ display:'flex', gap:10, alignItems:'center', marginTop:8 }}>
                  <ThemedButton
                    kind="secondary"
                    onClick={translateReplyToEnglish}
                    loading={isTranslatingReply}
                    disabled={isTranslatingReply || !String(replyOriginal || '').trim()}
                    ariaLabel="Translate to English"
                  >
                    🌐 Translate to English
                  </ThemedButton>

                  {translateReplyError ? (
                    <div style={{ fontSize: 12, color: '#fca5a5' }}>{translateReplyError}</div>
                  ) : null}
                </div>

                <div style={{ fontSize: 12, color: '#9ca3af', marginTop: 10, marginBottom: 6, fontWeight: 700 }}>
                  Translated (English — manager receives this)
                </div>

                <textarea
                  value={replyTranslated}
                  onChange={e => setReplyTranslated(e.target.value)}
                  placeholder="English version will appear here… (editable)"
                  style={{
                    width:'100%', minHeight:80, padding:10,
                    borderRadius:8, border:'1px solid #334155',
                    color:'#e5e7eb', background:'#0b1220',
                    resize:'vertical'
                  }}
                />

                <ThemedButton onClick={submitFixes} loading={submitting} kind="secondary" ariaLabel="Submit Fixes" full>
                  🔧 Submit Fixes
                </ThemedButton>
              </>
            ) : (
              <>
                <ThemedButton
                  onClick={runAiScan}
                  loading={scanStatus === 'running'}
                  kind="primary"
                  ariaLabel="Run AI Scan"
                  full
                >
                  🔍 Run AI Scan
                </ThemedButton>

                {/* AI Scan progress bar */}
                {scanStatus === 'running' && (
                  <div style={{ marginTop: 8 }}>
                    <div style={{ fontSize: 11, color: '#e5e7eb', marginBottom: 4 }}>
                      Analyzing photos… {Math.round(scanProgress)}%
                    </div>
                    <div
                      style={{
                        width: '100%',
                        height: 6,
                        borderRadius: 9999,
                        background: '#020617',
                        overflow: 'hidden',
                      }}
                    >
                      <div
                        style={{
                          width: `${scanProgress}%`,
                          height: '100%',
                          borderRadius: 9999,
                          background: '#22c55e',
                          transition: 'width 0.2s ease-out',
                        }}
                      />
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
                {scanMessage && (
                  <div style={{
                    marginTop: 6,
                    fontSize: 12,
                    whiteSpace: 'pre-wrap',
                    color: scanIssues.length ? '#facc15' : '#22c55e'
                  }}>
                    {scanMessage}
                  </div>
                )}
              </>
            )}
          </div>
        </div>

        {/* Reference-photo lightbox overlay */}
        {refLightbox.open && refLightbox.urls.length > 0 && (
          <div
            onClick={closeRefLightbox}
            style={{
              position: 'fixed',
              inset: 0,
              zIndex: 10020,
              background: 'rgba(0,0,0,0.88)',
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              padding: 16,
            }}
          >
            <div
              onClick={(e) => e.stopPropagation()}
              style={{
                position: 'relative',
                maxWidth: '100%',
                maxHeight: '100%',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                gap: 12,
              }}
            >
              <button
                type="button"
                onClick={closeRefLightbox}
                style={{
                position: 'absolute',
                top: 8,
                right: 8,
                borderRadius: 999,
                border: '1px solid rgba(148,163,184,0.7)',
                padding: '6px 10px',
                fontSize: 12,
                cursor: 'pointer',
                background: 'rgba(15,23,42,0.95)',
                color: '#e5e7eb',
                }}
              >
                ✕
              </button>

              <img
                src={refLightbox.urls[refLightbox.index]}
                alt="Reference"
                style={{
                  maxWidth: '100%',
                  maxHeight: '70vh',
                  borderRadius: 12,
                  boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                  objectFit: 'contain',
                }}
              />

              {refLightbox.urls.length > 1 && (
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 12,
                    marginTop: 4,
                    color: '#e5e7eb',
                    fontSize: 13,
                  }}
                >
                  <button
                    type="button"
                    onClick={prevRefLightbox}
                    style={{
                    borderRadius: 999,
                    border: '1px solid rgba(148,163,184,0.6)',
                    padding: '6px 10px',
                    background: 'rgba(15,23,42,0.9)',
                    cursor: 'pointer',
                    color: '#e5e7eb',
                    fontSize: 13,
                    }}
                  >
                    ‹ Prev
                  </button>
                  <span>
                    {refLightbox.index + 1} / {refLightbox.urls.length}
                  </span>
                  <button
                    type="button"
                    onClick={nextRefLightbox}
                    style={{
                    borderRadius: 999,
                    border: '1px solid rgba(148,163,184,0.6)',
                    padding: '6px 10px',
                    background: 'rgba(15,23,42,0.9)',
                    cursor: 'pointer',
                    color: '#e5e7eb',
                    fontSize: 13,
                    }}
                  >
                    Next ›
                  </button>
                </div>
              )}
            </div>
          </div>
        )}

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

        {/* NEW: Global hidden file inputs for the bottom-sheet picker */}
        <input
          type="file"
          ref={cameraInputRef}
          accept="image/*"
          capture="environment"
          style={{ display: 'none' }}
          onChange={handleGlobalFileChange}
        />
        <input
          type="file"
          ref={fileInputRef}
          style={{ display: 'none' }}
          onChange={handleGlobalFileChange}
        />

        {/* NEW: Bottom-sheet style picker overlay */}
        {pickerVisible && pickerShot && (
          <>
            {/* dark backdrop */}
            <div
              onClick={closePicker}
              style={{
                position: 'fixed',
                inset: 0,
                background: 'rgba(15,23,42,0.65)',
                zIndex: 9998,
              }}
            />
            {/* sheet */}
            <div
              style={{
                position: 'fixed',
                left: 0,
                right: 0,
                bottom: 0,
                zIndex: 9999,
                background: '#020617',
                borderTopLeftRadius: 16,
                borderTopRightRadius: 16,
                borderTop: '1px solid #1f2937',
                boxShadow: '0 -8px 30px rgba(0,0,0,0.6)',
                padding: '12px 16px 20px',
              }}
            >
              <div
                style={{
                  width: 40,
                  height: 4,
                  borderRadius: 999,
                  background: '#1f2937',
                  margin: '0 auto 10px',
                }}
              />
              <div style={{ fontSize: 14, fontWeight: 600, color: '#e5e7eb', textAlign: 'center', marginBottom: 10 }}>
                Choose photo source
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <button
                  type="button"
                  onClick={() => {
                    const el = cameraInputRef.current;
                    if (el) el.click();
                  }}
                  style={{
                    ...ui.btnPrimary,
                    width: '100%',
                    justifyContent: 'flex-start',
                    padding: '10px 12px',
                    fontSize: 14,
                  }}
                >
                  📷 Take Photo (Camera)
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const el = fileInputRef.current;
                    if (el) el.click();
                  }}
                  style={{
                    ...ui.btnSecondary,
                    width: '100%',
                    justifyContent: 'flex-start',
                    padding: '10px 12px',
                    fontSize: 14,
                  }}
                >
                  📁 Choose from device
                </button>
                <button
                  type="button"
                  onClick={closePicker}
                  style={{
                    ...ui.btnSecondary,
                    width: '100%',
                    justifyContent: 'center',
                    padding: '8px 12px',
                    fontSize: 13,
                    marginTop: 4,
                    opacity: 0.85,
                  }}
                >
                  ✕ Cancel
                </button>
              </div>
            </div>
          </>
        )}
      </section>
    </ChromeDark>
  );
}
