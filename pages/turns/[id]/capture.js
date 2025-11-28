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

  // --- AI scan state ---
  // scanStatus: 'idle' | 'running' | 'ready'
  const [scanStatus, setScanStatus] = useState('idle');
  const [scanMessage, setScanMessage] = useState('');
  const [scanIssues, setScanIssues] = useState([]); // array of strings
  const [scanProgress, setScanProgress] = useState(0); // 0–100 while scanning

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
