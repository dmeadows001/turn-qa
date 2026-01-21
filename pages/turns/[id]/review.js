// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

// ---- Optional manager auth header (does NOT break cleaners) ----
function getSupabaseAccessToken() {
  try {
    if (typeof window === 'undefined') return null;
    const raw = window.localStorage.getItem('turnqa-auth');
    if (!raw) return null;

    const parsed = JSON.parse(raw);

    // Common Supabase shapes across versions
    const token =
      parsed?.currentSession?.access_token ||
      parsed?.access_token ||
      parsed?.data?.session?.access_token ||
      null;

    return typeof token === 'string' && token.length > 20 ? token : null;
  } catch {
    return null;
  }
}

function authHeaders() {
  const token = getSupabaseAccessToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

async function fetchTurn(turnId) {
  const r = await fetch(`/api/get-turn?id=${turnId}`, {
    headers: { ...authHeaders() },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'get-turn failed');
  return j.turn;
}

async function fetchPhotos(turnId) {
  const r = await fetch(`/api/list-turn-photos?id=${turnId}`, {
    headers: { ...authHeaders() },
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'list-turn-photos failed');

  const raw = Array.isArray(j.photos) ? j.photos : [];

  // Keep *all* rows (no dedupe) and normalize flags/notes
  return raw
    .slice()
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .map((p) => ({
      ...p,
      shot_id: p.shot_id || null,
      id: p.id,
      area_key: p.area_key || '',
      created_at: p.created_at,
      // use signedUrl for display, but keep path for keys/findings
      url: p.signedUrl || p.url || '',
      path: p.path || '',
      is_fix: !!(p.is_fix ?? p.isFix ?? p.fix),
      needs_fix: !!(p.needs_fix ?? p.needsFix ?? p.flagged),
      cleaner_note: p.cleaner_note ?? p.cleanerNote ?? '',
      manager_note: p.manager_note ?? p.manager_notes ?? p.note ?? '',
    }));
}

// Load existing findings for this turn: { findings: [{ path, note, ...bilingual fields... }] }
async function fetchFindings(turnId) {
  try {
    const r = await fetch(`/api/turns/${turnId}/findings`, {
      headers: { ...authHeaders() },
    });
    if (!r.ok) return [];
    const j = await r.json().catch(() => ({}));
    return Array.isArray(j.findings) ? j.findings : [];
  } catch {
    return [];
  }
}

async function fetchTemplate(turnId) {
  try {
    const r = await fetch(`/api/turn-template?turnId=${turnId}`, {
      headers: { ...authHeaders() },
    });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'turn-template failed');

    const shots = Array.isArray(j.shots) ? j.shots : [];
    return shots.map(s => ({
      shot_id: s.shot_id,
      area_key: s.area_key || '',
      label: s.label || s.area_key || 'Section',
      min_count: s.min_count || 0,
    }));
  } catch (e) {
    console.warn('[review] fetchTemplate failed:', e?.message || e);
    return [];
  }
}

function buildSections(photos, templateShots) {
  const byShot = new Map();      // shot_id -> Photo[]
  const leftovers = [];          // photos without a matching shot_id
  const hasShotId = p => p && typeof p.shot_id === 'string' && p.shot_id;

  (photos || []).forEach(p => {
    if (hasShotId(p)) {
      const sid = p.shot_id;
      if (!byShot.has(sid)) byShot.set(sid, []);
      byShot.get(sid).push(p);
    } else {
      leftovers.push(p);
    }
  });

  const sections = [];

  // template order first
  templateShots.forEach(s => {
    const list = byShot.get(s.shot_id) || [];
    if (list.length) {
      list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      sections.push({ key: s.shot_id, title: s.label || s.area_key || 'Section', photos: list });
      byShot.delete(s.shot_id);
    }
  });

  // any shot_ids not in template (edge cases)
  for (const [sid, list] of byShot.entries()) {
    list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
    sections.push({ key: sid, title: 'Additional uploads', photos: list });
  }

  // leftovers by area_key / Uncategorized
  if (leftovers.length) {
    const byArea = leftovers.reduce((acc, p) => {
      const k = (p.area_key || '').trim() || '__UNCAT__';
      (acc[k] ||= []).push(p);
      return acc;
    }, {});
    Object.entries(byArea).forEach(([k, list]) => {
      list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at));
      sections.push({
        key: `area:${k}`,
        title: k === '__UNCAT__' ? 'Additional uploads' : k,
        photos: list,
      });
    });
  }

  return sections;
}

function badgeStyle(status) {
  const map = {
    approved:    { bg:'#064e3b', fg:'#86efac', bd:'#065f46' },  // green
    submitted:   { bg:'#0b3b72', fg:'#93c5fd', bd:'#1d4ed8' },  // blue
    needs_fix:   { bg:'#4a2f04', fg:'#fcd34d', bd:'#d97706' },  // amber
    in_progress: { bg:'#1f2937', fg:'#cbd5e1', bd:'#334155' }   // slate
  };
  const c = map[status] || { bg:'#1f2937', fg:'#cbd5e1', bd:'#334155' };
  return {
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.bd}`,
    padding:'2px 8px',
    borderRadius: 999,
    fontSize:12,
    fontWeight:700,
    display:'inline-block'
  };
}

// Amber “needs fix” highlight (manager findings)
const flaggedCardStyle = {
  border: '1px solid #d97706',
  boxShadow: '0 0 0 3px rgba(217,119,6,0.25) inset',
  background: '#0b1220'
};

// Green “FIX” highlight (cleaner resubmitted photo)
const fixCardStyle = {
  border: '1px solid #065f46',
  boxShadow: '0 0 0 3px rgba(5,150,105,0.20) inset',
  background: '#071a16'
};

// Dashed section frame, like cleaner need-fix
const sectionWrapStyle = {
  border: '2px dashed #334155',
  borderRadius: 12,
  padding: 12,
  background: '#0b1220',
  marginBottom: 18,
};

// Stable per-photo key: prefer storage path, then id; never include created_at
function keyFor(p) {
  if (!p) return '';
  if (p.path && p.path.length) return p.path;   // canonical, stable across renders
  if (p.id) return String(p.id);
  // last resort: area + shot (stable enough within a turn)
  return `${p.area_key || 'area'}::${p.shot_id || 'shot'}`;
}

function normalizeNote(raw) {
  const base = { original: '', translated: '', sourceLang: 'en', targetLang: 'es' };
  if (!raw) return base;
  if (typeof raw === 'string') return { ...base, original: raw };
  return { ...base, ...raw };
}

async function translateViaApi(text, targetLang) {
  const r = await fetch('/api/translate', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, targetLang }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'Translate failed');
  return String(j.translatedText || '').trim();
}

function lc(s) { return String(s || '').toLowerCase(); }

// For manager review:
// - Needs-fix (manager→cleaner): show manager ORIGINAL EN for manager reference.
// - Fix (cleaner→manager): show EN (usually translated).
function pickEnglishForManager(finding) {
  if (!finding) return '';

  const o = String(finding.note_original || '').trim();
  const t = String(finding.note_translated || '').trim();
  const sent = String(finding.note_sent || '').trim();
  const legacy = String(finding.note || '').trim();

  const oLang = lc(finding.note_original_lang);
  const tLang = lc(finding.note_translated_lang);
  const sentLang = lc(finding.note_sent_lang);

  if (oLang === 'en' && o) return o;
  if (tLang === 'en' && t) return t;
  if (sentLang === 'en' && sent) return sent;

  // reasonable fallbacks
  if (o) return o;
  if (t) return t;
  if (sent) return sent;
  return legacy;
}

// What was actually sent to cleaner (normally ES), useful for cleaner view (or optional manager reference)
function pickNoteSentToCleaner(finding) {
  if (!finding) return '';
  const sent = String(finding.note_sent || '').trim();
  if (sent) return sent;
  const legacy = String(finding.note || '').trim();
  return legacy;
}

/** Manager Review Getting Started modal (localStorage-backed) */
function GettingStartedModal({ enabled, storageKey, children }) {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (!enabled) return;
    if (typeof window === 'undefined') return;

    try {
      const seen = window.localStorage.getItem(storageKey);
      if (!seen) setOpen(true);
    } catch {
      setOpen(true);
    }
  }, [enabled, storageKey]);

  function dismiss() {
    try {
      if (dontShow && typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, '1');
      }
    } catch {
      // ignore
    }
    setOpen(false);
  }

  if (!enabled || !open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{ ...ui.card, maxWidth: 820, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div>
            <h2 style={{ margin: 0 }}>Getting Started</h2>
            <div style={{ ...ui.subtle, marginTop: 6 }}>
              Manager review: mark issues, translate if needed, then send to cleaner
            </div>
          </div>

          <button type="button" onClick={dismiss} style={ui.btnSecondary} aria-label="Dismiss">
            ✕
          </button>
        </div>

        <div style={{ marginTop: 14, color: '#cbd5e1', lineHeight: 1.5 }}>
          {children}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', color: '#cbd5e1' }}>
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              style={{ transform: 'scale(1.05)' }}
            />
            Don&apos;t show this again
          </label>

          <button type="button" onClick={dismiss} style={ui.btnPrimary}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

// --- PhotoCard at module scope so it doesn't remount each render ---
const PhotoCard = memo(function PhotoCard({
  p,
  isManagerMode,
  selectedKeys,
  notesByKey,
  findingsByKey,
  setNoteFor,
  toggleKey,
  onTranslate,
  translateBusyByKey
}) {
  const k = keyFor(p);
  const selected = selectedKeys.has(k);

  const noteObj = normalizeNote(notesByKey[k]);
  const originalVal = noteObj.original || '';
  const translatedVal = noteObj.translated || '';

  const isFix = !!p.is_fix;

  const finding = findingsByKey[k] || null;

  const flaggedFromFindings = !!finding;
  const flaggedFromRow = !!p.needs_fix;
  // Only ORIGINAL photos can be “needs fix”
  const flagged = !isFix && (flaggedFromFindings || flaggedFromRow);

  const styleCard = isFix ? fixCardStyle : (flagged ? flaggedCardStyle : null);

  const busy = !!(translateBusyByKey && translateBusyByKey[k]);

  // Manager-facing note logic:
  // - Needs-fix (amber): manager should see their ORIGINAL EN reference
  // - Fix (green): manager sees EN only (cleaner’s translated)
  const managerNoteEnglish =
    (isManagerMode && flagged)
      ? (pickEnglishForManager(finding) || String(p.manager_note || '').trim())
      : '';

  // What cleaner sees (ES) — keep for non-manager view
  const noteToCleaner = pickNoteSentToCleaner(finding) || String(p.manager_note || '').trim();

  return (
    <div
      style={{
        border: '1px solid #334155',
        borderRadius: 12,
        overflow: 'hidden',
        background: '#0b1220',
        ...(styleCard || {})
      }}
    >
      <a href={p.url} target="_blank" rel="noreferrer">
        <img
          src={p.url}
          alt={p.area_key || 'photo'}
          style={{ width: '100%', display: 'block', aspectRatio: '4/3', objectFit: 'cover' }}
        />
      </a>

      <div style={{ padding: 10, fontSize: 12 }}>
        <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center', gap:8 }}>
          <div style={{ display:'flex', alignItems:'center', gap:8 }}>
            <b>{p.area_key || '—'}</b>

            {flagged && (
              <span style={{
                padding:'2px 8px',
                borderRadius:999,
                fontSize:11,
                fontWeight:700,
                color:'#fcd34d',
                background:'#4a2f04',
                border:'1px solid #d97706'
              }}>
                needs fix
              </span>
            )}

            {isFix && (
              <span style={{
                padding:'2px 8px',
                borderRadius:999,
                fontSize:11,
                fontWeight:700,
                color:'#86efac',
                background:'#064e3b',
                border:'1px solid #065f46'
              }}>
                FIX
              </span>
            )}
          </div>

          {isManagerMode && (
            <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none' }}>
              <input
                type="checkbox"
                checked={selected}
                onChange={() => toggleKey(p)}
                style={{ transform:'scale(1.1)' }}
              />
              <span>Needs fix</span>
            </label>
          )}
        </div>

        <div style={{ color: '#9ca3af' }}>{new Date(p.created_at).toLocaleString()}</div>
        <div style={{ color: '#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.path}</div>

        {/* OPTION A: Only show note + translation UI when checkbox is checked */}
        {isManagerMode && selected && !isFix && (
          <div style={{ marginTop: 10 }}>
            <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:6 }}>
              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>
                Original note (EN)
              </div>

              <button
                type="button"
                onClick={() => onTranslate(p)}
                disabled={busy || !originalVal.trim()}
                style={{
                  ...ui.btnSecondary,
                  padding: '6px 10px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#cbd5e1',
                  opacity: (busy || !originalVal.trim()) ? 0.6 : 1
                }}
                title="Translate English → Spanish"
              >
                {busy ? 'Translating…' : 'Translate → ES'}
              </button>
            </div>

            <textarea
              value={originalVal}
              onChange={e => setNoteFor(p, { original: e.target.value, sourceLang: 'en' })}
              rows={2}
              placeholder="Write your note in English…"
              style={{ ...ui.input, width:'100%', padding:'8px 10px', resize:'vertical', background:'#0b1220' }}
            />

            <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, margin: '8px 0 6px' }}>
              Translated note (ES) — sent to cleaner
            </div>

            <textarea
              value={translatedVal}
              onChange={e => setNoteFor(p, { translated: e.target.value, targetLang: 'es' })}
              rows={2}
              placeholder="Spanish will appear here… (editable)"
              style={{ ...ui.input, width:'100%', padding:'8px 10px', resize:'vertical', background:'#0b1220' }}
            />

            <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
              Tip: If you change the English above, click Translate again to refresh the Spanish.
            </div>
          </div>
        )}

        {/* Manager view: show ORIGINAL EN for needs-fix cards (manager memory) */}
        {isManagerMode && flagged && !!managerNoteEnglish && (
          <div
            style={{
              marginTop: 8,
              padding: '8px 10px',
              background: '#0f172a',
              border: '1px solid #334155',
              borderRadius: 8,
              color: '#cbd5e1'
            }}
          >
            <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 700 }}>
              Manager note (original EN)
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{managerNoteEnglish}</div>
          </div>
        )}

        {/* Fix photo: show cleaner note (assumed already EN for manager) */}
        {isFix && !!p.cleaner_note && (
          <div style={{
            marginTop:8,
            padding:'8px 10px',
            background:'#052e2b',
            border:'1px solid #065f46',
            borderRadius:8,
            color:'#86efac',
            whiteSpace:'pre-wrap'
          }}>
            {p.cleaner_note}
          </div>
        )}

        {/* Cleaner / non-manager view: show the note that was SENT to cleaner (normally ES) */}
        {!isManagerMode && flagged && !!noteToCleaner && (
          <div style={{
            marginTop:8,
            padding:'8px 10px',
            background:'#0f172a',
            border:'1px solid #334155',
            borderRadius:8,
            color:'#cbd5e1'
          }}>
            <div style={{ fontSize:11, color:'#94a3b8', marginBottom:4, fontWeight:700 }}>Manager note</div>
            <div style={{ whiteSpace:'pre-wrap' }}>{noteToCleaner}</div>
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => {
  // only re-render this card when its own props change
  const pk = keyFor(prev.p);
  const nk = keyFor(next.p);
  if (pk !== nk) return false; // different photo instance

  // note value for THIS photo (stringify for object support)
  const prevNote = prev.notesByKey[pk];
  const nextNote = next.notesByKey[nk];
  const prevStr = typeof prevNote === 'string' ? prevNote : JSON.stringify(prevNote || {});
  const nextStr = typeof nextNote === 'string' ? nextNote : JSON.stringify(nextNote || {});
  if (prevStr !== nextStr) return false;

  // selection for THIS photo
  const prevSel = prev.selectedKeys.has(pk);
  const nextSel = next.selectedKeys.has(nk);
  if (prevSel !== nextSel) return false;

  // flagged state for THIS photo (presence of finding)
  const prevFlag = !!prev.findingsByKey[pk];
  const nextFlag = !!next.findingsByKey[nk];
  if (prevFlag !== nextFlag) return false;

  const prevFix = !!prev.p.is_fix;
  const nextFix = !!next.p.is_fix;
  if (prevFix !== nextFix) return false;

  // translate busy state for THIS photo (optional prop)
  const prevBusy = !!(prev.translateBusyByKey && prev.translateBusyByKey[pk]);
  const nextBusy = !!(next.translateBusyByKey && next.translateBusyByKey[nk]);
  if (prevBusy !== nextBusy) return false;

  return true; // unchanged → skip render
});

export default function Review() {
  const router = useRouter();
  const turnId = router.query.id;

  // Manager controls are only shown with ?manager=1
  const isManagerMode =
    typeof window !== 'undefined' &&
    new URLSearchParams(window.location.search).get('manager') === '1';

  const [turn, setTurn] = useState(null);
  const [status, setStatus] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [templateShots, setTemplateShots] = useState([]);
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  // Top-level summary note (Option B)
  const [summaryNote, setSummaryNote] = useState({ original: '', translated: '', sourceLang: 'en', targetLang: 'es' });
  const [summaryBusy, setSummaryBusy] = useState(false);

  const [acting, setActing] = useState(false);

  // Per-photo state (keyed by stable key)
  const [notesByKey, setNotesByKey] = useState({});
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  // Findings for highlight + prefill (keyed by photoKey)
  const [findingsByKey, setFindingsByKey] = useState({});

  // Translate busy per-photo
  const [translateBusyByKey, setTranslateBusyByKey] = useState({});

  // Cleaner “fix & resubmit” (only used on cleaner view, kept for parity)
  const [cleanerReply, setCleanerReply] = useState('');
  const [staged, setStaged] = useState([]);
  const [uploadingFix] = useState(false);
  const [submittingFixes, setSubmittingFixes] = useState(false);
  const fileInputRef = useRef(null);

  // manager-side display of the most recent cleaner message
  const [lastCleanerNote, setLastCleanerNote] = useState('');

  useEffect(() => {
    if (!turnId) return;
    (async () => {
      setLoading(true);
      setLoadErr('');
      try {
        const [t, ph, ts] = await Promise.all([
          fetchTurn(turnId),
          fetchPhotos(turnId),
          fetchTemplate(turnId),
        ]);
        setTurn(t);
        setStatus(t && t.status ? t.status : 'in_progress');
        setTemplateShots(ts);

        const cleanerNote =
          (t && (t.cleaner_reply ?? t.cleaner_note ?? t.cleaner_message)) || '';
        setLastCleanerNote(cleanerNote);
        setCleanerReply('');

        // Backward compat: if we only have legacy turn.manager_note, treat it as EN original.
        const legacySummary = String((t && t.manager_note) || '').trim();
        setSummaryNote({ original: legacySummary, translated: '', sourceLang: 'en', targetLang: 'es' });

        setPhotos(ph);

        // Prefill findings keyed by photo key
        const f = await fetchFindings(turnId);
        if (f.length) {
          // Build index: path -> keys currently shown
          const pathToKeys = ph.reduce((acc, p) => {
            const k = keyFor(p);
            const path = p.path || '';
            if (!acc[path]) acc[path] = [];
            acc[path].push(k);
            return acc;
          }, {});

          const map = {};
          const sel = new Set();
          const notes = {};

          f.forEach(it => {
            const path = (it && it.path) || '';
            const keys = pathToKeys[path] || [];
            for (const k of keys) {
              // IMPORTANT: keep full finding object so manager can access bilingual fields later
              map[k] = it;

              if (isManagerMode) sel.add(k);

              // Prefill editable note object:
              // - original: prefer EN original if present, else legacy note
              // - translated: prefer ES translated if present
              const o = String(it.note_original || '').trim();
              const t2 = String(it.note_translated || '').trim();
              const oLang = lc(it.note_original_lang);
              const tLang = lc(it.note_translated_lang);

              const originalPref =
                (oLang === 'en' && o) ? o :
                (o ? o : String(it.note || ''));

              const translatedPref =
                (tLang === 'es' && t2) ? t2 :
                (t2 ? t2 : '');

              notes[k] = {
                original: originalPref || '',
                translated: translatedPref || '',
                sourceLang: oLang || 'en',
                targetLang: tLang || 'es',
              };
            }
          });

          setFindingsByKey(map);
          if (isManagerMode) setSelectedKeys(sel);
          setNotesByKey(prev => ({ ...notes, ...prev }));
        } else {
          setFindingsByKey({});
        }
      } catch (e) {
        setLoadErr(e.message || 'load failed');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, isManagerMode]);

  const uniqueAreas = useMemo(() => {
    const set = new Set((photos || []).map(p => p.area_key).filter(Boolean));
    return Array.from(set);
  }, [photos]);

  // Build the same sections structure the cleaner page uses
  const sections = useMemo(
    () => buildSections(photos, templateShots),
    [photos, templateShots]
  );

  // --- Stable callbacks so children don't remount during typing ---
  const toggleKey = useCallback((p) => {
    const k = keyFor(p);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const setNoteFor = useCallback((p, patch) => {
    const k = keyFor(p);
    setNotesByKey(prev => {
      const cur = normalizeNote(prev[k]);
      return { ...prev, [k]: { ...cur, ...patch } };
    });
  }, []);

  const onTranslate = useCallback(async (p) => {
    const k = keyFor(p);
    const cur = normalizeNote(notesByKey[k]);
    const text = (cur.original || '').trim();
    if (!text) return;

    setTranslateBusyByKey(prev => ({ ...prev, [k]: true }));
    try {
      const es = await translateViaApi(text, 'es');
      setNotesByKey(prev => {
        const cur2 = normalizeNote(prev[k]);
        return {
          ...prev,
          [k]: {
            ...cur2,
            sourceLang: 'en',
            targetLang: 'es',
            translated: es
          }
        };
      });
    } catch (e) {
      alert(e.message || 'Translate failed');
    } finally {
      setTranslateBusyByKey(prev => ({ ...prev, [k]: false }));
    }
  }, [notesByKey]);

  async function translateSummaryToEs() {
    const text = String(summaryNote.original || '').trim();
    if (!text) return;
    setSummaryBusy(true);
    try {
      const es = await translateViaApi(text, 'es');
      setSummaryNote(prev => ({
        ...prev,
        sourceLang: 'en',
        targetLang: 'es',
        translated: es
      }));
    } catch (e) {
      alert(e.message || 'Translate failed');
    } finally {
      setSummaryBusy(false);
    }
  }

  // --- Approve ---
  async function markApproved() {
    if (!turnId) return;
    setActing(true);
    try {
      const ok = window.confirm('Approve this turn?');
      if (!ok) return;

      // Keep existing API contract: send a single string.
      // Manager is English-speaking, so store the EN original here.
      const manager_note = String(summaryNote.original || '').trim();

      const r = await fetch('/api/update-turn-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_id: turnId, new_status: 'approved', manager_note })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'update failed');
      setStatus('approved');
      alert('Turn approved ✅');

      // Redirect manager back to dashboard
      window.location.href = '/managers/turns';
    } catch (e) {
      alert(e.message || 'Could not update status.');
    } finally {
      setActing(false);
    }
  }

  // --- Needs Fix (with notes) ---
  async function sendNeedsFix() {
    if (!turnId) return;
    setActing(true);
    try {
      const payloadNotes = [];

      photos.forEach(p => {
        const k = keyFor(p);
        const selected = selectedKeys.has(k);
        const obj = normalizeNote(notesByKey[k]);

        const original = (obj.original || '').trim();
        const translated = (obj.translated || '').trim();

        // Cleaner should receive Spanish when available; fallback to original
        const note_to_cleaner = (translated || original || '').trim();

        if (selected || original.length > 0 || translated.length > 0) {
          payloadNotes.push({
            photo_id: p.id || null,
            path: p.path || '',
            // Legacy field: what the cleaner sees
            note: note_to_cleaner,

            // Robust fields
            note_original: original || null,
            note_translated: translated || null,
            note_original_lang: original ? (obj.sourceLang || 'en') : null,
            note_translated_lang: translated ? (obj.targetLang || 'es') : null,

            // Also include "sent" explicitly for robustness
            note_sent: note_to_cleaner || null,
            note_sent_lang: translated ? (obj.targetLang || 'es') : (original ? (obj.sourceLang || 'en') : null),
          });
        }
      });

      const summaryOriginal = String(summaryNote.original || '').trim();
      const summaryTranslated = String(summaryNote.translated || '').trim();
      const summarySent = (summaryTranslated || summaryOriginal || '').trim();

      if (payloadNotes.length === 0 && !summarySent) {
        alert('Select at least one photo or add a summary note before sending “Needs fix”.');
        setActing(false);
        return;
      }

      // Send bilingual summary object (backend supports this now)
      const summaryPayload = summarySent ? {
        original: summaryOriginal || '',
        translated: summaryTranslated || '',
        sent: summarySent || '',
        original_lang: summaryOriginal ? (summaryNote.sourceLang || 'en') : null,
        translated_lang: summaryTranslated ? (summaryNote.targetLang || 'es') : null,
        sent_lang: summaryTranslated ? (summaryNote.targetLang || 'es') : (summaryOriginal ? (summaryNote.sourceLang || 'en') : null),
      } : null;

      const r = await fetch(`/api/turns/${turnId}/needs-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: payloadNotes,                 // [{ path, note, note_original, note_translated, ... }]
          summary: summaryPayload,
          send_sms: true
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Needs-fix failed');

      setStatus('needs_fix');

      // Update local highlight immediately (by key)
      const newMap = {};
      const sel = new Set();
      const newNotes = {};

      payloadNotes.forEach(it => {
        photos.filter(p => (p.path || '') === it.path).forEach(p => {
          const k = keyFor(p);

          // IMPORTANT: keep a finding-like object so PhotoCard can pick EN/ES correctly
          newMap[k] = {
            path: it.path || '',
            note: it.note || '',
            note_original: it.note_original || '',
            note_translated: it.note_translated || '',
            note_original_lang: it.note_original_lang || 'en',
            note_translated_lang: it.note_translated_lang || 'es',
            note_sent: it.note_sent || it.note || '',
            note_sent_lang: it.note_sent_lang || (it.note_translated ? 'es' : 'en'),
            severity: 'warn'
          };

          sel.add(k);

          // Keep note object for history in UI
          newNotes[k] = {
            original: it.note_original || '',
            translated: it.note_translated || '',
            sourceLang: it.note_original_lang || 'en',
            targetLang: it.note_translated_lang || 'es',
          };
        });
      });

      setFindingsByKey(newMap);
      setSelectedKeys(sel);
      setNotesByKey(prev => ({ ...prev, ...newNotes }));

      alert('Marked Needs Fix. Cleaner notified via SMS.');

      // Redirect manager back to dashboard
      window.location.href = '/managers/turns';
    } catch (e) {
      alert(e.message || 'Could not send needs-fix.');
    } finally {
      setActing(false);
    }
  }

  if (!turnId) {
    return (
      <ChromeDark title="Turn Review">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  const backHref = isManagerMode ? '/managers/turns' : '/cleaner/turns';

  return (
    <ChromeDark title="Turn Review">
      {/* ✅ Manager Getting Started popup */}
      <GettingStartedModal enabled={isManagerMode} storageKey="turnqa_gs_manager_review_v1">
        <div style={{ marginBottom: 10 }}>
          For any photo that needs fixing, check <b>Needs fix</b>.
          Then type your note in <b>English</b>.
        </div>
        <div style={{ marginBottom: 10 }}>
          If your cleaner speaks Spanish, click <b>Translate → ES</b> so the cleaner receives Spanish.
          If your cleaner speaks English, just leave it in English (no need to translate).
        </div>
        <div>
          When you&apos;re done, click <b>🛠️ Send Needs Fix</b> to notify the cleaner.
        </div>
      </GettingStartedModal>

      <section style={ui.sectionGrid}>
        {/* Header / Meta */}
        <div style={ui.card}>
          <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:12, flexWrap:'wrap' }}>
            <a href={backHref} style={{ ...ui.btnSecondary, textDecoration:'none' }}>← Back to turns</a>
            <div style={{ fontSize:12, color:'#94a3b8' }}>
              Turn ID: <code style={{ userSelect:'all' }}>{turnId}</code>
            </div>
          </div>

          <h2 style={{ marginTop: 12, marginBottom: 6 }}>
            Review Photos
            <span style={{ marginLeft:10, verticalAlign:'middle' }}>
              <span style={badgeStyle(status)}>{(status || '—').replace('_',' ')}</span>
            </span>
          </h2>

          {!isManagerMode && (
            <div style={{
              marginTop: 8, padding: '8px 10px',
              background:'#0b1220', border:'1px solid #334155', borderRadius:10,
              color:'#cbd5e1', fontSize:13
            }}>
              Read-only manager controls hidden. If your manager asked for fixes, use the “Fix & resubmit” box below.
            </div>
          )}

          {/* Manager actions */}
          {isManagerMode && (
            <div style={{
              margin:'12px 0 6px',
              padding:12,
              border:'1px solid #334155',
              borderRadius:12,
              background:'#0f172a'
            }}>
              <div style={{ display:'flex', alignItems:'center', gap:10, flexWrap:'wrap' }}>
                <div style={{ fontWeight:700 }}>Status:</div>
                <span style={badgeStyle(status)}>{status || '—'}</span>
                {loadErr && <span style={{ color:'#fca5a5' }}>({loadErr})</span>}
              </div>

              {/* Show most recent cleaner message to the manager */}
              {lastCleanerNote && (
                <div style={{
                  marginTop: 10,
                  padding: 12,
                  borderRadius: 8,
                  // match FIX / cleaner-note green styling
                  border: '1px solid #065f46',
                  background: '#052e2b',
                  color: '#86efac',
                  boxShadow: '0 0 0 3px rgba(5,150,105,0.20) inset',
                }}>
                  <div
                    style={{
                      fontSize: 12,
                      fontWeight: 700,
                      color: '#bbf7d0',
                      marginBottom: 6,
                      textTransform: 'uppercase',
                      letterSpacing: 0.03,
                    }}
                  >
                    Cleaner note
                  </div>
                  <div style={{ whiteSpace: 'pre-wrap' }}>
                    {lastCleanerNote}
                  </div>
                </div>
              )}

              {/* SUMMARY (Option B translator) */}
              <div style={{ marginTop:10 }}>
                <div style={{ display:'flex', alignItems:'center', justifyContent:'space-between', gap:10, marginBottom:6 }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#9ca3af' }}>
                    Optional overall note to cleaner (summary) — Original (EN)
                  </div>

                  <button
                    type="button"
                    onClick={translateSummaryToEs}
                    disabled={summaryBusy || !String(summaryNote.original || '').trim()}
                    style={{
                      ...ui.btnSecondary,
                      padding: '6px 10px',
                      border: '1px solid #334155',
                      background: '#0b1220',
                      color: '#cbd5e1',
                      opacity: (summaryBusy || !String(summaryNote.original || '').trim()) ? 0.6 : 1
                    }}
                    title="Translate English → Spanish"
                  >
                    {summaryBusy ? 'Translating…' : 'Translate → ES'}
                  </button>
                </div>

                <textarea
                  value={summaryNote.original}
                  onChange={e => setSummaryNote(prev => ({ ...prev, original: e.target.value, sourceLang: 'en' }))}
                  rows={3}
                  placeholder="Write your summary in English…"
                  style={{
                    ...ui.input,
                    width:'100%',
                    padding:'10px 12px',
                    resize:'vertical',
                    background:'#0b1220'
                  }}
                />

                <div style={{ fontSize:12, fontWeight:700, color:'#9ca3af', margin:'10px 0 6px' }}>
                  Translated (ES) — sent to cleaner
                </div>

                <textarea
                  value={summaryNote.translated}
                  onChange={e => setSummaryNote(prev => ({ ...prev, translated: e.target.value, targetLang: 'es' }))}
                  rows={3}
                  placeholder="Spanish will appear here… (editable)"
                  style={{
                    ...ui.input,
                    width:'100%',
                    padding:'10px 12px',
                    resize:'vertical',
                    background:'#0b1220'
                  }}
                />

                <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                  Tip: If you change the English above, click Translate again to refresh the Spanish.
                </div>
              </div>

              <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
                <button
                  onClick={sendNeedsFix}
                  disabled={acting || !turnId}
                  style={{
                    ...ui.btnSecondary,
                    border:'1px solid #d97706',
                    background:'#4a2f04',
                    color:'#fcd34d'
                  }}
                >
                  {acting ? '…' : '🛠️ Send Needs Fix (with notes)'}
                </button>

                <button
                  onClick={markApproved}
                  disabled={acting || !turnId}
                  style={ui.btnPrimary}
                >
                  {acting ? '…' : '✅ Approve'}
                </button>
              </div>
            </div>
          )}

          <div style={{ ...ui.subtle, marginTop: 10 }}>
            Click any photo to open full-size in a new tab.
          </div>
        </div>

        {/* Photos (grouped like cleaner: by shot label, then leftovers) */}
        <div style={ui.card}>
          {loading ? (
            <div>Loading photos…</div>
          ) : (sections && sections.length > 0) ? (
            sections.map(sec => (
              <div key={sec.key} style={sectionWrapStyle}>
                <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', margin:'2px 4px 10px' }}>
                  <h3 style={{ margin:0 }}>{sec.title || 'Section'}</h3>
                  <div style={{ fontSize:12, color:'#94a3b8' }}>
                    {sec.photos.length} photo{sec.photos.length === 1 ? '' : 's'}
                  </div>
                </div>

                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:12 }}>
                  {sec.photos.map(p => (
                    <PhotoCard
                      key={keyFor(p)}
                      p={p}
                      isManagerMode={isManagerMode}
                      selectedKeys={selectedKeys}
                      notesByKey={notesByKey}
                      findingsByKey={findingsByKey}
                      setNoteFor={setNoteFor}
                      toggleKey={toggleKey}
                      onTranslate={onTranslate}
                      translateBusyByKey={translateBusyByKey}
                    />
                  ))}
                </div>
              </div>
            ))
          ) : (photos && photos.length > 0) ? (
            (() => {
              // Fallback: group by area_key so managers still see everything
              const byArea = (photos || []).reduce((acc, p) => {
                const k = (p.area_key || '').trim() || '__UNCAT__';
                (acc[k] ||= []).push(p);
                return acc;
              }, {});
              Object.values(byArea).forEach(list =>
                list.sort((a,b) => new Date(b.created_at) - new Date(a.created_at))
              );
              const areas = Object.keys(byArea)
                .filter(k => k !== '__UNCAT__')
                .sort((a,b) => a.localeCompare(b, undefined, { numeric:true }))
                .concat(byArea['__UNCAT__'] ? ['__UNCAT__'] : []);

              return areas.map(areaKey => (
                <div key={areaKey} style={sectionWrapStyle}>
                  <div style={{ display:'flex', alignItems:'baseline', justifyContent:'space-between', margin:'2px 4px 10px' }}>
                    <h3 style={{ margin:0 }}>
                      {areaKey === '__UNCAT__' ? 'Additional uploads' : areaKey}
                    </h3>
                    <div style={{ fontSize:12, color:'#94a3b8' }}>
                      {byArea[areaKey].length} photo{byArea[areaKey].length === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))', gap:12 }}>
                    {byArea[areaKey].map(p => (
                      <PhotoCard
                        key={keyFor(p)}
                        p={p}
                        isManagerMode={isManagerMode}
                        selectedKeys={selectedKeys}
                        notesByKey={notesByKey}
                        findingsByKey={findingsByKey}
                        setNoteFor={setNoteFor}
                        toggleKey={toggleKey}
                        onTranslate={onTranslate}
                        translateBusyByKey={translateBusyByKey}
                      />
                    ))}
                  </div>
                </div>
              ));
            })()
          ) : (
            <div style={ui.muted}>No photos yet.</div>
          )}
        </div>

        {uniqueAreas.length > 1 && (
          <div style={{ ...ui.subtle }}>
            Areas in this turn: {uniqueAreas.join(' • ')}
          </div>
        )}
      </section>
    </ChromeDark>
  );
}
