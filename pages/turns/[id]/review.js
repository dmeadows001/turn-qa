// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState, useCallback, memo } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// ✅ Always get the real Supabase session token (works with sb-... localStorage keys)
async function authHeadersAsync() {
  try {
    const sb = supabaseBrowser();
    const { data: { session } } = await sb.auth.getSession();
    const token = session?.access_token;
    return token ? { Authorization: `Bearer ${token}` } : {};
  } catch {
    return {};
  }
}

async function fetchTurn(turnId) {
  const headers = await authHeadersAsync();
  const r = await fetch(`/api/get-turn?id=${turnId}`, { headers });
  const j = await r.json().catch(() => ({}));

  if (!r.ok) {
    const err = new Error(j.error || 'get-turn failed');
    err.code = j.code || null;
    throw err;
  }

  return j.turn;
}

async function fetchPhotos(turnId) {
  const headers = await authHeadersAsync();
  const r = await fetch(`/api/list-turn-photos?id=${turnId}`, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) {
  const err = new Error(j.error || 'list-turn-photos failed');
  err.code = j.code || null;
  throw err;
}

  const raw = Array.isArray(j.photos) ? j.photos : [];
  return raw
    .slice()
    .sort((a, b) => new Date(a.created_at || 0) - new Date(b.created_at || 0))
    .map((p) => ({
      ...p,
      shot_id: p.shot_id || null,
      id: p.id,
      area_key: p.area_key || '',
      created_at: p.created_at,
      url: p.signedUrl || p.url || '',
      path: p.path || '',
      correction_task_id: p.correction_task_id || null,
      is_fix: !!(p.is_fix ?? p.isFix ?? p.fix),
      needs_fix: !!(p.needs_fix ?? p.needsFix ?? p.flagged),
      cleaner_note: p.cleaner_note ?? p.cleanerNote ?? '',
      manager_note: p.manager_note ?? p.manager_notes ?? p.note ?? '',
    }));
}

// Load existing findings for this turn: { findings: [{ path, note, ...bilingual fields... }] }
async function fetchFindings(turnId) {
  try {
    const headers = await authHeadersAsync();
    const r = await fetch(`/api/turns/${turnId}/findings`, { headers });
    if (!r.ok) return [];
    const j = await r.json().catch(() => ({}));
    return Array.isArray(j.findings) ? j.findings : [];
  } catch {
    return [];
  }
}

async function fetchTemplate(turnId) {
  try {
    const headers = await authHeadersAsync();
    const r = await fetch(`/api/turn-template?turnId=${turnId}`, { headers });
    const j = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(j.error || 'turn-template failed');

    const shots = Array.isArray(j.shots) ? j.shots : [];
    return shots.map((s) => ({
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

// NEW: turn history
async function fetchTurnHistory(turnId) {
  const headers = await authHeadersAsync();
  const r = await fetch(`/api/turn-history?id=${turnId}`, { headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || 'turn-history failed');
  return j;
}

function buildSections(photos, templateShots) {
  const byShot = new Map(); // shot_id -> Photo[]
  const leftovers = []; // photos without a matching shot_id
  const hasShotId = (p) => p && typeof p.shot_id === 'string' && p.shot_id;

  (photos || []).forEach((p) => {
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
  templateShots.forEach((s) => {
    const list = byShot.get(s.shot_id) || [];
    if (list.length) {
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
      sections.push({ key: s.shot_id, title: s.label || s.area_key || 'Section', photos: list });
      byShot.delete(s.shot_id);
    }
  });

  // any shot_ids not in template (edge cases)
  for (const [sid, list] of byShot.entries()) {
    list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
      list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at));
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
    approved: { bg: '#064e3b', fg: '#86efac', bd: '#065f46' }, // green
    submitted: { bg: '#0b3b72', fg: '#93c5fd', bd: '#1d4ed8' }, // blue
    needs_fix: { bg: '#4a2f04', fg: '#fcd34d', bd: '#d97706' }, // amber
    in_progress: { bg: '#1f2937', fg: '#cbd5e1', bd: '#334155' }, // slate
  };
  const c = map[status] || { bg: '#1f2937', fg: '#cbd5e1', bd: '#334155' };
  return {
    background: c.bg,
    color: c.fg,
    border: `1px solid ${c.bd}`,
    padding: '2px 8px',
    borderRadius: 999,
    fontSize: 12,
    fontWeight: 700,
    display: 'inline-block',
  };
}

// Amber “needs fix” highlight (manager findings)
const flaggedCardStyle = {
  border: '1px solid #d97706',
  boxShadow: '0 0 0 3px rgba(217,119,6,0.25) inset',
  background: '#0b1220',
};

// Neutral blue highlight: a correction is submitted, NOT automatically approved
const fixCardStyle = {
  border: '1px solid #2563eb',
  boxShadow: '0 0 0 3px rgba(37,99,235,0.15) inset',
  background: '#0b1930',
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
  if (p.path && p.path.length) return p.path; // canonical, stable across renders
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

function lc(s) {
  return String(s || '').toLowerCase();
}

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

        <div style={{ marginTop: 14, color: '#cbd5e1', lineHeight: 1.5 }}>{children}</div>

        <div
          style={{
            display: 'flex',
            justifyContent: 'space-between',
            gap: 12,
            alignItems: 'center',
            marginTop: 16,
            flexWrap: 'wrap',
          }}
        >
          <label
            style={{
              display: 'flex',
              gap: 8,
              alignItems: 'center',
              cursor: 'pointer',
              color: '#cbd5e1',
            }}
          >
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

// Thumbnail previews are optional: existing photos without thumbnails still work.
// Full-resolution URLs remain the destination of the surrounding photo links.
const turnThumbnailCache = new Map();
function TurnPhotoPreview({ photo, alt, style }) {
  const originalUrl = photo?.url || '';
  const originalPath = String(photo?.path || photo?.storage_path || '').replace(/^photos\//, '');
  const thumbPath = originalPath.startsWith('turns/')
    ? originalPath.replace(/^turns\//, 'turn-thumbs/')
    : null;
  const [previewUrl, setPreviewUrl] = useState(() => thumbPath ? '' : originalUrl);
  const [usingThumb, setUsingThumb] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setPreviewUrl(thumbPath ? '' : originalUrl);
    setUsingThumb(false);
    if (!thumbPath || !originalUrl) return () => { cancelled = true; };

    (async () => {
      const cached = turnThumbnailCache.get(thumbPath);
      if (cached && cached.expiresAt > Date.now()) {
        if (!cancelled) { setPreviewUrl(cached.url); setUsingThumb(true); }
        return;
      }
      try {
        const headers = await authHeadersAsync();
        const response = await fetch('/api/sign-photo', {
          method: 'POST',
          headers: { ...headers, 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ path: thumbPath, expires: 600 }),
        });
        if (!response.ok) { if (!cancelled) setPreviewUrl(originalUrl); return; }
        const result = await response.json();
        if (!result?.url) { if (!cancelled) setPreviewUrl(originalUrl); return; }
        turnThumbnailCache.set(thumbPath, { url: result.url, expiresAt: Date.now() + 8 * 60 * 1000 });
        if (!cancelled) { setPreviewUrl(result.url); setUsingThumb(true); }
      } catch (e) {
        // Thumbnail signing is best-effort; the original stays available.
        if (!cancelled) setPreviewUrl(originalUrl);
      }
    })();
    return () => { cancelled = true; };
  }, [thumbPath, originalUrl]);

  return (
    <img
      src={previewUrl || undefined}
      alt={alt}
      loading="lazy"
      decoding="async"
      onError={() => {
        if (usingThumb) {
          turnThumbnailCache.delete(thumbPath);
          setUsingThumb(false);
          setPreviewUrl(originalUrl);
        }
      }}
      style={style}
    />
  );
}

// --- PhotoCard at module scope so it doesn't remount each render ---
const PhotoCard = memo(
  function PhotoCard({
    p,
    isManagerMode,
    selectedKeys,
    notesByKey,
    findingsByKey,
    setNoteFor,
    toggleKey,
    onTranslate,
    translateBusyByKey,
    allowSelection = true,
    acceptedTaskIds,
    correctionDecisionByPhotoId,
    correctionAttemptByPhotoId,
    showDecisionEditor = false,
    originalFlagged = false,
    readOnly = false,
  }) {
    const k = keyFor(p);
    const selected = selectedKeys.has(k);

    const noteObj = normalizeNote(notesByKey[k]);
    const originalVal = noteObj.original || '';
    const translatedVal = noteObj.translated || '';

    const isFix = !!p.is_fix;

    const finding = findingsByKey[k] || null;

    const flaggedFromFindings = !!finding && !isFix;
    const flaggedFromRow = false; // legacy flags may remain true after a later round
    // Only ORIGINAL photos can be “needs fix”
    const flagged = !acceptedTaskIds?.has(p.correction_task_id) && (flaggedFromFindings || flaggedFromRow);
    const isOriginalNeedsFix = !isFix && (originalFlagged || !!p.needs_fix || flaggedFromFindings);
    // Per-photo decisions, not task-level acceptance: earlier rejected attempts
    // must remain red even when a later attempt resolves the same task.
    const fixDecision = isFix ? correctionDecisionByPhotoId?.get(String(p.id)) : null;
    const accepted = isFix && fixDecision === 'accepted';
    const rejected = isFix && fixDecision === 'rejected';
    const attemptNumber = isFix ? correctionAttemptByPhotoId?.get(String(p.id)) : null;

    // One neutral border for all photos; badges alone communicate the audit status.
    const styleCard = null;

    const busy = !!(translateBusyByKey && translateBusyByKey[k]);

    // Manager-facing note logic:
    // - Needs-fix (amber): manager should see their ORIGINAL EN reference
    // - Fix (green): manager sees EN only (cleaner’s translated)
    const managerNoteEnglish =
      isManagerMode && flagged ? pickEnglishForManager(finding) || String(p.manager_note || '').trim() : '';

    // What cleaner sees (ES) — keep for non-manager view
    const noteToCleaner = pickNoteSentToCleaner(finding) || String(p.manager_note || '').trim();

    return (
      <div
        style={{
          border: '1px solid #334155',
          borderRadius: 12,
          overflow: 'hidden',
          background: '#0b1220',
          ...(styleCard || {}),
        }}
      >
        <a href={p.url} target="_blank" rel="noreferrer">
          <TurnPhotoPreview
            photo={p}
            alt={p.area_key || 'photo'}
            style={{ width: '100%', display: 'block', aspectRatio: showDecisionEditor ? 'auto' : '4/3', height: 'auto', objectFit: showDecisionEditor ? 'contain' : 'cover' }}
          />
        </a>

        <div style={{ padding: 12, fontSize: 12 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 8 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap', rowGap: 6 }}>
              <b>{p.area_key || '—'}</b>

              {isOriginalNeedsFix && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#bfdbfe',
                    background: '#172554',
                    border: '1px solid #3b82f6',
                  }}
                >
                  Original Needs Fix
                </span>
              )}

               {accepted && (
                <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: '#86efac', background: '#064e3b', border: '1px solid #065f46' }}>{`Accepted Fix${attemptNumber ? ` — Attempt ${attemptNumber}` : ''}`}</span>
               )}
               {rejected && (
                 <span style={{ padding: '2px 8px', borderRadius: 999, fontSize: 11, fontWeight: 700, color: '#fca5a5', background: '#450a0a', border: '1px solid #b91c1c' }}>{`Rejected Fix${attemptNumber ? ` — Attempt ${attemptNumber}` : ''}`}</span>
               )}
               {isFix && !accepted && !rejected && (
                <span
                  style={{
                    padding: '2px 8px',
                    borderRadius: 999,
                    fontSize: 11,
                    fontWeight: 700,
                    color: '#93c5fd',
                    background: '#0b3b72',
                    border: '1px solid #2563eb',
                  }}
                >
                  Correction uploaded
                </span>
              )}
            </div>

             {isManagerMode && !readOnly && allowSelection && !isFix && (
              <label style={{ display: 'flex', alignItems: 'center', gap: 6, cursor: 'pointer', userSelect: 'none' }}>
                <input
                  type="checkbox"
                  checked={selected}
                  onChange={() => toggleKey(p)}
                  style={{ transform: 'scale(1.1)' }}
                />
                <span>Needs fix</span>
              </label>
            )}
          </div>

          <div style={{ color: '#9ca3af' }}>{new Date(p.created_at).toLocaleString()}</div>
          {/* Show note + translation UI for selected original OR correction photos */}
          {isManagerMode && !readOnly && (selected || showDecisionEditor) && (
            <div style={{ marginTop: 10 }}>
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  gap: 10,
                  marginBottom: 6,
                }}
              >
                <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700 }}>Original note (EN)</div>

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
                    opacity: busy || !originalVal.trim() ? 0.6 : 1,
                  }}
                  title="Translate English → Spanish"
                >
                  {busy ? 'Translating…' : 'Translate → ES'}
                </button>
              </div>

              <textarea
                value={originalVal}
                onChange={(e) => setNoteFor(p, { original: e.target.value, sourceLang: 'en' })}
                rows={2}
                placeholder="Write your note in English…"
                style={{ ...ui.input, width: '100%', padding: '8px 10px', resize: 'vertical', background: '#0b1220' }}
              />

              <div style={{ fontSize: 11, color: '#94a3b8', fontWeight: 700, margin: '8px 0 6px' }}>
                Translated note (ES) — sent to cleaner
              </div>

              <textarea
                value={translatedVal}
                onChange={(e) => setNoteFor(p, { translated: e.target.value, targetLang: 'es' })}
                rows={2}
                placeholder="Spanish will appear here… (editable)"
                style={{ ...ui.input, width: '100%', padding: '8px 10px', resize: 'vertical', background: '#0b1220' }}
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
                color: '#cbd5e1',
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
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: '#052e2b',
                border: '1px solid #065f46',
                borderRadius: 8,
                color: '#86efac',
                whiteSpace: 'pre-wrap',
              }}
            >
              {p.cleaner_note}
            </div>
          )}

          {/* Cleaner / non-manager view: show the note that was SENT to cleaner (normally ES) */}
          {!isManagerMode && flagged && !!noteToCleaner && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: '#0f172a',
                border: '1px solid #334155',
                borderRadius: 8,
                color: '#cbd5e1',
              }}
            >
              <div style={{ fontSize: 11, color: '#94a3b8', marginBottom: 4, fontWeight: 700 }}>Manager note</div>
              <div style={{ whiteSpace: 'pre-wrap' }}>{noteToCleaner}</div>
            </div>
          )}
        </div>
      </div>
    );
  },
  (prev, next) => {
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
     if (prev.allowSelection !== next.allowSelection || prev.showDecisionEditor !== next.showDecisionEditor) return false;
     if (!!prev.acceptedTaskIds?.has(prev.p.correction_task_id) !== !!next.acceptedTaskIds?.has(next.p.correction_task_id)) return false;
     if (prev.p.needs_fix !== next.p.needs_fix || prev.p.correction_task_id !== next.p.correction_task_id) return false;
    if (prev.originalFlagged !== next.originalFlagged || prev.readOnly !== next.readOnly) return false;
    if (prev.correctionDecisionByPhotoId?.get(String(prev.p.id)) !== next.correctionDecisionByPhotoId?.get(String(next.p.id))) return false;
    if (prev.correctionAttemptByPhotoId?.get(String(prev.p.id)) !== next.correctionAttemptByPhotoId?.get(String(next.p.id))) return false;

    return true; // unchanged → skip render
  }
);

// A required photo and its earlier attempts remain together in one card.
// History images mount only when expanded, avoiding unnecessary downloads.
function RequiredPhotoWithHistory({ photo, history = [], cardProps }) {
  const [expanded, setExpanded] = useState(false);
  return (
    <div>
      <PhotoCard p={photo} {...cardProps} />
      {history.length > 0 && (
        <div style={{ marginTop: 6, border: '1px solid #334155', borderRadius: 10, overflow: 'hidden', background: '#0b1220' }}>
          <button
            type="button"
            onClick={() => setExpanded(v => !v)}
            aria-expanded={expanded}
            style={{ width: '100%', textAlign: 'left', padding: '10px 12px', border: 0, color: '#bfdbfe', background: '#17243a', fontWeight: 700, cursor: 'pointer', fontSize: 12 }}
          >
            {expanded ? '▾' : '▸'} View Photo History ({history.length})
          </button>
          {expanded && (
            <div style={{ display: 'grid', gap: 10, padding: 10 }}>
              {history.map(oldPhoto => (
                <PhotoCard
                  key={keyFor(oldPhoto)}
                  p={oldPhoto}
                  {...cardProps}
                  readOnly={true}
                  allowSelection={false}
                  showDecisionEditor={false}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ---------- NEW: History helpers (safe, non-breaking) ----------
function nonEmpty(s) {
  const t = String(s ?? '').trim();
  return t ? t : '';
}

function getHistoryMessageParts(it) {
  // it.text is what we currently show (usually "sent")
  const meta = it?.meta || {};
  const sent = nonEmpty(meta.sent) || nonEmpty(it?.text);
  const original = nonEmpty(meta.original);
  const translated = nonEmpty(meta.translated);

  const sentLang = nonEmpty(meta.sent_lang) || nonEmpty(it?.lang);
  const originalLang = nonEmpty(meta.original_lang);
  const translatedLang = nonEmpty(meta.translated_lang);

  // Avoid duplicating identical strings
  const norm = (v) => String(v || '').trim();
  const s0 = norm(sent);
  const o0 = norm(original);
  const t0 = norm(translated);

  const showSent = !!s0;
  const showOriginal = !!o0 && o0 !== s0;
  const showTranslated = !!t0 && t0 !== s0 && t0 !== o0;

  return {
    showSent,
    showOriginal,
    showTranslated,
    sent: s0,
    original: o0,
    translated: t0,
    sentLang: sentLang || null,
    originalLang: originalLang || null,
    translatedLang: translatedLang || null,
  };
}

function langChip(lang) {
  const v = String(lang || '').trim();
  if (!v) return null;
  return (
    <span
      style={{
        fontSize: 10,
        fontWeight: 800,
        padding: '2px 8px',
        borderRadius: 999,
        border: '1px solid #334155',
        background: '#0f172a',
        color: '#cbd5e1',
        textTransform: 'uppercase',
        letterSpacing: 0.04,
      }}
    >
      {v}
    </span>
  );
}

function block(label, value, chip) {
  return (
    <div
      style={{
        marginTop: 8,
        padding: '10px 12px',
        borderRadius: 10,
        border: '1px solid #334155',
        background: '#0f172a',
        color: '#cbd5e1',
      }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 10, marginBottom: 6 }}>
        <div style={{ fontSize: 11, fontWeight: 900, color: '#94a3b8', textTransform: 'uppercase', letterSpacing: 0.04 }}>
          {label}
        </div>
        {chip}
      </div>
      <div style={{ whiteSpace: 'pre-wrap' }}>{value}</div>
    </div>
  );
}
// -------------------------------------------------------------

export default function Review() {
  const router = useRouter();
  const turnId = router.query.id;

  // Manager controls are only shown with ?manager=1
  const isManagerMode =
    typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('manager') === '1';

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
  const [activeFindings, setActiveFindings] = useState([]);
  const [viewFullTurn, setViewFullTurn] = useState(false);
  const [correctionDecisions, setCorrectionDecisions] = useState([]);
  const [decisionBusy, setDecisionBusy] = useState(false);

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

  // NEW: History modal state
  const [historyOpen, setHistoryOpen] = useState(false);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyErr, setHistoryErr] = useState('');
  const [historyItems, setHistoryItems] = useState([]);

  useEffect(() => {
    if (!turnId) return;
    (async () => {
      setLoading(true);
      setLoadErr('');
      try {
        const [t, ph, ts] = await Promise.all([fetchTurn(turnId), fetchPhotos(turnId), fetchTemplate(turnId)]);
        setTurn(t);
        setStatus(t && t.status ? t.status : 'in_progress');
        setTemplateShots(ts);

        const cleanerNote = String(
          t?.cleaner_reply_translated ?? t?.cleaner_reply ?? t?.cleaner_note ?? t?.cleaner_message ?? ''
        ).trim();
        setLastCleanerNote(cleanerNote);

        setCleanerReply('');

        // Summary note: STRICT structured fields.
        const summaryOriginal = String(t?.manager_note_original || '').trim();
        const summaryTranslated = String(t?.manager_note_translated || '').trim();
        const summarySent = String(t?.manager_note_sent || '').trim();
        const legacy = String(t?.manager_note || '').trim(); // legacy "sent" mirror

        setSummaryNote({
          original: summaryOriginal || (!summarySent && !summaryTranslated ? legacy : ''),
          translated: summaryTranslated || summarySent || '',
          sourceLang: String(t?.manager_note_original_lang || 'en'),
          targetLang: String(t?.manager_note_translated_lang || t?.manager_note_sent_lang || 'es'),
        });

        setPhotos(ph);

        // Active findings describe outstanding tasks, NOT a new manager selection.
        // Never pre-select old findings: doing so would re-reject accepted corrections.
        const f = await fetchFindings(turnId);
        setActiveFindings(f);
        const decisionHeaders = await authHeadersAsync();
        const decisionResponse = await fetch(`/api/turns/${turnId}/correction-decision`, { headers: decisionHeaders });
        if (!decisionResponse.ok) throw new Error('Could not load correction decisions');
        const decisionData = await decisionResponse.json();
        setCorrectionDecisions(decisionData.decisions || []);
        setFindingsByKey(Object.fromEntries(f.filter(x => x.path).map(x => [x.path, x])));
        setSelectedKeys(new Set());
        setNotesByKey({});
        setViewFullTurn(false);
            } catch (e) {
        if (e?.code === 'BILLING_REQUIRED' && isManagerMode) {
          router.replace('/billing');
          return;
        }

        setLoadErr(e?.message || 'load failed');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, isManagerMode]);

  const uniqueAreas = useMemo(() => {
    const set = new Set((photos || []).map((p) => p.area_key).filter(Boolean));
    return Array.from(set);
  }, [photos]);

  // Build the same sections structure the cleaner page uses
  // For a resubmission, review ONLY the latest correction for each outstanding task.
  // An initial submission still displays the complete turn.
  const isCorrectionReview = isManagerMode && status === 'submitted' && activeFindings.length > 0;
  const taskIds = useMemo(() => new Set(activeFindings.map(f => f.correction_task_id).filter(Boolean)), [activeFindings]);
  const latestCorrections = useMemo(() => {
    if (!isCorrectionReview) return [];
    const byTask = new Map();
    const ordered = [...photos].filter(p => p.is_fix).sort((a,b) => new Date(b.created_at || 0) - new Date(a.created_at || 0));
    for (const photo of ordered) {
      if (photo.correction_task_id && taskIds.has(photo.correction_task_id) && !byTask.has(photo.correction_task_id)) {
        byTask.set(photo.correction_task_id, photo);
      }
    }
    // Legacy photos have no task ID. Match by shot ONLY if there is exactly
    // one outstanding issue in that shot; otherwise require an explicit link.
    const byId = new Map(photos.map(p => [String(p.id), p]));
    for (const finding of activeFindings) {
      const taskId = finding.correction_task_id;
      if (!taskId || byTask.has(taskId)) continue;
      const original = byId.get(String(finding.photo_id));
      if (!original?.shot_id) continue;
      const sameShotTasks = activeFindings.filter(f => byId.get(String(f.photo_id))?.shot_id === original.shot_id);
      if (sameShotTasks.length !== 1) continue;
      const legacy = ordered.find(p => !p.correction_task_id && p.shot_id === original.shot_id);
      if (legacy) byTask.set(taskId, { ...legacy, correction_task_id: taskId });
    }
    return [...byTask.values()];
  }, [photos, activeFindings, isCorrectionReview, taskIds]);
  const decidedPhotoIds = useMemo(() => new Set(correctionDecisions.map(d => String(d.photo_id))), [correctionDecisions]);
  // Resolve the newest submitted photo to its task, including legacy photos
  // that have no correction_task_id but unambiguously match a single issue.
  const latestByTask = useMemo(() => new Map(latestCorrections.map(p => [String(p.correction_task_id), p])), [latestCorrections]);
  const pendingDecisionCount = isCorrectionReview ? latestCorrections.filter(p => !decidedPhotoIds.has(String(p.id))).length : 0;
  const unresolvedTaskCount = isCorrectionReview ? Math.max(0, taskIds.size - latestByTask.size) : 0;
  const rejectedCount = isCorrectionReview ? latestCorrections.filter(p => correctionDecisions.some(d => String(d.photo_id) === String(p.id) && d.decision === 'rejected')).length : 0;
  const visiblePhotos = isCorrectionReview && !viewFullTurn ? latestCorrections : photos;
  const acceptedTaskIds = useMemo(() => new Set(correctionDecisions.filter(d => d.decision === 'accepted').map(d => d.correction_task_id)), [correctionDecisions]);
  const readOnly = status === 'approved';
  // Match the actual decision to each individual correction photo.
  const correctionDecisionByPhotoId = useMemo(() => {
    const byPhoto = new Map();
    for (const decision of correctionDecisions) {
      if (decision.photo_id && (decision.decision === 'accepted' || decision.decision === 'rejected')) {
        byPhoto.set(String(decision.photo_id), decision.decision);
      }
    }
    return byPhoto;
  }, [correctionDecisions]);

  // The approval button is gated by the latest photo for EVERY active task,
  // not by whether an old rejected decision exists in the audit history.
  const allCorrectionsAccepted = isCorrectionReview && taskIds.size > 0 &&
    [...taskIds].every(taskId => {
      const latest = latestByTask.get(String(taskId));
      return !!latest && correctionDecisions.some(d =>
        String(d.photo_id) === String(latest.id) &&
        String(d.correction_task_id) === String(taskId) && d.decision === 'accepted'
      );
    });

  // Historical attempts, including the current pending photo. Match legacy
  // photos only via the conservative single-issue-per-shot fallback above.
  const correctionHistory = useMemo(() => {
    const byPhotoId = new Map(photos.map(p => [String(p.id), p]));
    const groups = new Map();
    const recorded = new Set();
    for (const d of correctionDecisions) {
      const photo = byPhotoId.get(String(d.photo_id));
      if (!photo) continue;
      const taskId = String(d.correction_task_id || photo.correction_task_id || '');
      if (!taskId) continue;
      if (!groups.has(taskId)) groups.set(taskId, []);
      groups.get(taskId).push({ photo: { ...photo, correction_task_id: taskId }, decision: d });
      recorded.add(String(photo.id));
    }
    for (const photo of photos) {
      if (!photo.is_fix || !photo.correction_task_id || recorded.has(String(photo.id))) continue;
      const taskId = String(photo.correction_task_id);
      if (!groups.has(taskId)) groups.set(taskId, []);
      groups.get(taskId).push({ photo, decision: null });
      recorded.add(String(photo.id));
    }
    // Critical: latestCorrections may contain a legacy photo whose task ID
    // was inferred safely by shot. It must also appear in the timeline.
    for (const photo of latestCorrections) {
      if (recorded.has(String(photo.id))) continue;
      const taskId = String(photo.correction_task_id || '');
      if (!taskId) continue;
      if (!groups.has(taskId)) groups.set(taskId, []);
      groups.get(taskId).push({ photo, decision: null });
      recorded.add(String(photo.id));
    }
    return [...groups.entries()].map(([taskId, attempts]) => ({
      taskId,
      attempts: attempts.sort((a,b) => new Date(a.photo.created_at || 0) - new Date(b.photo.created_at || 0)),
    }));
  }, [photos, correctionDecisions, latestCorrections]);
  // Attempt numbers follow each correction task's chronological timeline.
  // The original flagged photo is not counted as a correction attempt.
  const correctionAttemptByPhotoId = useMemo(() => {
    const numbers = new Map();
    for (const group of correctionHistory) {
      group.attempts.forEach(({ photo }, index) => {
        if (photo?.id) numbers.set(String(photo.id), index + 1);
      });
    }
    return numbers;
  }, [correctionHistory]);
  const hasCorrectionHistory = isManagerMode && (correctionHistory.length > 0 || activeFindings.some(f => f.correction_task_id));

  const correctionGroups = useMemo(() => {
    const photosById = new Map(photos.map(p => [String(p.id), p]));
    const historyByTask = new Map(correctionHistory.map(g => [String(g.taskId), g.attempts]));
    const findingsByTask = new Map();
    for (const f of activeFindings) {
      if (f.correction_task_id && !findingsByTask.has(String(f.correction_task_id))) {
        findingsByTask.set(String(f.correction_task_id), f);
      }
    }
    const ids = new Set([...findingsByTask.keys(), ...historyByTask.keys()]);
    return [...ids].map((taskId, index) => {
      const finding = findingsByTask.get(taskId) || null;
      const attempts = historyByTask.get(taskId) || [];
      const latest = latestByTask.get(taskId) || null;
      // Some findings API responses omit photo_id even though qa_findings stores it.
      // Recover the original using the finding's exact storage path first.
      // Only use shot_id as a fallback when there is exactly ONE eligible
      // original in that shot, so separate required photos never get merged.
      let original = finding?.photo_id ? photosById.get(String(finding.photo_id)) : null;
      if (!original && finding) {
        const rawPaths = [finding.path, finding.storage_path, finding.evidence_url]
          .filter(Boolean).map(v => String(v).split('?')[0]);
        const exactMatches = photos.filter(p => !p.is_fix && rawPaths.some(path =>
          path === p.path || path.endsWith('/' + p.path) ||
          (p.path && path.includes(encodeURIComponent(p.path)))
        ));
        if (exactMatches.length === 1) original = exactMatches[0];
      }
      if (!original && attempts.length) {
        const attemptShotIds = [...new Set(attempts.map(a => a.photo?.shot_id).filter(Boolean))];
        if (attemptShotIds.length === 1) {
          const candidates = photos.filter(p => !p.is_fix && p.shot_id === attemptShotIds[0]);
          // Never infer by room/area: a room can contain many required photos.
          if (candidates.length === 1) original = candidates[0];
        }
      }
      const representative = original || latest || attempts[0]?.photo;
      const area = representative?.area_key || templateShots.find(t => t.shot_id === representative?.shot_id)?.label || 'Correction issue';
      return { taskId, index, finding, attempts, latest, original, area };
    });
  }, [photos, activeFindings, correctionHistory, latestByTask, templateShots]);

  // Gallery: one current image per required photo. Link correction attempts
  // only by the recorded correction task and its ORIGINAL photo ID; never
  // collapse other required photos just because they share a room or shot.
  const { galleryPhotos, galleryHistoryByPhotoId } = useMemo(() => {
    if (isCorrectionReview && !viewFullTurn) {
      return { galleryPhotos: visiblePhotos, galleryHistoryByPhotoId: new Map() };
    }
    const replacements = new Map();
    const historyByCurrent = new Map();
    const suppressedIds = new Set();
    const registeredIds = new Set(photos.map(p => String(p.id)));

    for (const group of correctionGroups) {
      const original = group.original;
      if (!original?.id || !registeredIds.has(String(original.id))) {
        if (group.attempts.length) console.warn('[review] Cannot link correction history to a unique original photo:', group.taskId);
        continue;
      }
      const attempts = group.attempts.map(a => a.photo).filter(p => p?.id && registeredIds.has(String(p.id)) && String(p.id) !== String(original.id));
      if (!attempts.length) continue;
      // Prefer the latest accepted attempt, otherwise the latest attempt.
      // A rejected latest attempt remains visible until a new fix arrives.
      const accepted = attempts.filter(p => correctionDecisionByPhotoId.get(String(p.id)) === 'accepted');
      const current = accepted.length ? accepted[accepted.length - 1] : attempts[attempts.length - 1];
      if (!current?.id || replacements.has(String(original.id))) continue;
      const previous = [original, ...attempts.filter(p => String(p.id) !== String(current.id))];
      replacements.set(String(original.id), current);
      historyByCurrent.set(String(current.id), previous);
      for (const p of attempts) suppressedIds.add(String(p.id));
    }

    const result = [];
    const seen = new Set();
    for (const p of visiblePhotos) {
      const id = String(p.id);
      if (suppressedIds.has(id)) continue;
      const chosen = replacements.get(id) || p;
      const chosenId = String(chosen.id);
      if (seen.has(chosenId)) continue;
      result.push(chosen);
      seen.add(chosenId);
    }
    return { galleryPhotos: result, galleryHistoryByPhotoId: historyByCurrent };
  }, [visiblePhotos, photos, correctionGroups, correctionDecisionByPhotoId, isCorrectionReview, viewFullTurn]);
  const sections = useMemo(() => buildSections(galleryPhotos, templateShots), [galleryPhotos, templateShots]);

  // Original photos remain identifiable even after the task has been accepted.
  const originalFlaggedPhotoIds = useMemo(() => new Set([
    ...activeFindings.map(f => String(f.photo_id || '')),
    ...correctionGroups.map(g => String(g.original?.id || '')),
  ].filter(Boolean)), [activeFindings, correctionGroups]);

  // Display property information when supplied by get-turn, without changing the API.
  const propertyLabel = turn?.property?.name || turn?.property_name || turn?.property?.address || turn?.property_address || turn?.property?.street_address || '';
  // Turn-level date (not an individual photo timestamp).
  const turnStartDate = turn?.started_at || turn?.startedAt || turn?.start_time || turn?.created_at || null;
  const formattedTurnDate = turnStartDate && !Number.isNaN(new Date(turnStartDate).getTime())
    ? new Date(turnStartDate).toLocaleDateString(undefined, { year: 'numeric', month: 'long', day: 'numeric' })
    : '';


  async function decideCorrection(p, decision) {
    if (readOnly || !p.correction_task_id || !p.id || decisionBusy) return;
    const noteObj = normalizeNote(notesByKey[keyFor(p)]);
    if (decision === 'rejected' && !String(noteObj.translated || noteObj.original || '').trim()) {
      alert('Enter a reason for requesting another fix. Translate to Spanish when appropriate.');
      return;
    }
    if (!window.confirm(decision === 'accepted' ? 'Accept this correction permanently?' : 'Request another correction for this task?')) return;
    setDecisionBusy(true);
    try {
      const headers = await authHeadersAsync();
      const response = await fetch(`/api/turns/${turnId}/correction-decision`, {
        method:'POST',headers:{'Content-Type':'application/json',...headers},
        body:JSON.stringify({photo_id:p.id,correction_task_id:p.correction_task_id,decision,
          note_original:noteObj.original || '',note_translated:noteObj.translated || ''})
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error || 'Could not record decision');
      window.location.reload();
    } catch(e) { alert(e.message || 'Could not record correction decision'); }
    finally { setDecisionBusy(false); }
  }


  // --- Stable callbacks so children don't remount during typing ---
  const toggleKey = useCallback((p) => {
    const k = keyFor(p);
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }, []);

  const setNoteFor = useCallback((p, patch) => {
    const k = keyFor(p);
    setNotesByKey((prev) => {
      const cur = normalizeNote(prev[k]);
      return { ...prev, [k]: { ...cur, ...patch } };
    });
  }, []);

  const onTranslate = useCallback(
    async (p) => {
      const k = keyFor(p);
      const cur = normalizeNote(notesByKey[k]);
      const text = (cur.original || '').trim();
      if (!text) return;

      setTranslateBusyByKey((prev) => ({ ...prev, [k]: true }));
      try {
        const es = await translateViaApi(text, 'es');
        setNotesByKey((prev) => {
          const cur2 = normalizeNote(prev[k]);
          return {
            ...prev,
            [k]: {
              ...cur2,
              sourceLang: 'en',
              targetLang: 'es',
              translated: es,
            },
          };
        });
      } catch (e) {
        alert(e.message || 'Translate failed');
      } finally {
        setTranslateBusyByKey((prev) => ({ ...prev, [k]: false }));
      }
    },
    [notesByKey]
  );

  async function translateSummaryToEs() {
    const text = String(summaryNote.original || '').trim();
    if (!text) return;
    setSummaryBusy(true);
    try {
      const es = await translateViaApi(text, 'es');
      setSummaryNote((prev) => ({
        ...prev,
        sourceLang: 'en',
        targetLang: 'es',
        translated: es,
      }));
    } catch (e) {
      alert(e.message || 'Translate failed');
    } finally {
      setSummaryBusy(false);
    }
  }

  // NEW: open history modal + fetch items
  async function openHistory() {
    if (!turnId) return;
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryErr('');
    try {
      const data = await fetchTurnHistory(turnId);
      const existing = Array.isArray(data.items) ? data.items : [];
      const decisions = correctionDecisions.map(d => ({
        id: `decision:${d.id}`, type: 'message', actor: 'manager',
        event: d.decision === 'accepted' ? 'Accepted correction' : 'Requested another fix',
        at: d.created_at, text: d.note_sent || d.note || '',
        meta: {sent:d.note_sent || d.note || '',sent_lang:d.note_sent_lang,
          original:d.note_original,original_lang:d.note_original_lang,
          translated:d.note_translated,translated_lang:d.note_translated_lang},
      }));
      setHistoryItems([...existing, ...decisions].sort((a,b) => new Date(a.at || 0) - new Date(b.at || 0)));
    } catch (e) {
      setHistoryErr(e?.message || 'Could not load history');
      setHistoryItems([]);
    } finally {
      setHistoryLoading(false);
    }
  }

  // --- Approve ---
  async function markApproved() {
    if (readOnly) return;
    if (activeFindings.length > 0 && !allCorrectionsAccepted) { alert('Accept every outstanding correction first.'); return; }
    if (!turnId) return;
    setActing(true);
    try {
             if (isCorrectionReview && unresolvedTaskCount > 0) {
         alert('Some outstanding correction tasks have no identifiable replacement photo. Cannot approve until they are resolved.');
         return;
       }
       if (isCorrectionReview && (pendingDecisionCount > 0 || rejectedCount > 0 || taskIds.size > 0)) { alert('Every correction must be explicitly accepted before approving.'); return; }
       const ok = window.confirm('Approve this turn?');
      if (!ok) return;

      const manager_note = String(summaryNote.original || '').trim();

      const headers = await authHeadersAsync();

      const r = await fetch('/api/update-turn-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({ turn_id: turnId, new_status: 'approved', manager_note }),
    });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'update failed');
      setStatus('approved');
      alert('Turn approved ✅');

      window.location.href = '/managers/turns';
    } catch (e) {
      alert(e.message || 'Could not update status.');
    } finally {
      setActing(false);
    }
  }

  // --- Needs Fix (with notes) ---
  async function sendNeedsFix() {
    if (readOnly || !turnId) return;
    setActing(true);
    try {
      const payloadNotes = [];

             visiblePhotos.forEach((p) => {
         if (isCorrectionReview && !latestCorrections.some(x => x.path === p.path)) return;
        const k = keyFor(p);
        const selected = selectedKeys.has(k);
        const obj = normalizeNote(notesByKey[k]);

        const original = (obj.original || '').trim();
        const translated = (obj.translated || '').trim();

        const note_to_cleaner = (translated || original || '').trim();

        if (selected) {
          payloadNotes.push({
                         photo_id: p.id || null,
             correction_task_id: p.correction_task_id || null,
            path: p.path || '',
            note: note_to_cleaner,

            note_original: original || null,
            note_translated: translated || null,
            note_original_lang: original ? obj.sourceLang || 'en' : null,
            note_translated_lang: translated ? obj.targetLang || 'es' : null,

            note_sent: note_to_cleaner || null,
            note_sent_lang: translated ? obj.targetLang || 'es' : original ? obj.sourceLang || 'en' : null,
          });
        }
      });

      const summaryOriginal = String(summaryNote.original || '').trim();
      const summaryTranslated = String(summaryNote.translated || '').trim();
      const summarySent = (summaryTranslated || summaryOriginal || '').trim();

             if (isCorrectionReview && unresolvedTaskCount > 0) {
         alert('Some outstanding tasks have no identifiable correction photo. Refresh or link the missing corrections before reviewing.');
         return;
       }
       if (isCorrectionReview && payloadNotes.some(n => !n.correction_task_id)) {
         alert('One or more selected photos are not linked to a correction task. Please review the latest correction photo for each task.');
         return;
       }
       if (payloadNotes.length === 0 && !summarySent) {
        alert('Select at least one photo or add a summary note before sending “Needs fix”.');
        setActing(false);
        return;
      }

      const summaryPayload = summarySent
        ? {
            original: summaryOriginal || '',
            translated: summaryTranslated || '',
            sent: summarySent || '',
            original_lang: summaryOriginal ? summaryNote.sourceLang || 'en' : null,
            translated_lang: summaryTranslated ? summaryNote.targetLang || 'es' : null,
            sent_lang: summaryTranslated ? summaryNote.targetLang || 'es' : summaryOriginal ? summaryNote.sourceLang || 'en' : null,
          }
        : null;

      const headers = await authHeadersAsync();

      const r = await fetch(`/api/turns/${turnId}/needs-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...headers },
        body: JSON.stringify({
          notes: payloadNotes,
          summary: summaryPayload,
          send_sms: true,
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Needs-fix failed');

      setStatus('needs_fix');

      const newMap = {};
      const sel = new Set();
      const newNotes = {};

      payloadNotes.forEach((it) => {
        photos
          .filter((p) => (p.path || '') === it.path)
          .forEach((p) => {
            const k = keyFor(p);

            newMap[k] = {
              path: it.path || '',
              note: it.note || '',
              note_original: it.note_original || '',
              note_translated: it.note_translated || '',
              note_original_lang: it.note_original_lang || 'en',
              note_translated_lang: it.note_translated_lang || 'es',
              note_sent: it.note_sent || it.note || '',
              note_sent_lang: it.note_sent_lang || (it.note_translated ? 'es' : 'en'),
              severity: 'warn',
            };

            sel.add(k);

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
      setNotesByKey((prev) => ({ ...prev, ...newNotes }));

      alert('Marked Needs Fix. Cleaner notified via SMS.');

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

  // NOTE: There is intentionally NO "Go to review" button in this file.
  // This page *is* the review page.

  const backHref = isManagerMode ? '/managers/turns' : '/cleaner/turns';

  return (
    <ChromeDark title="Turn Review">
      {/* ✅ Manager Getting Started popup */}
      <GettingStartedModal enabled={isManagerMode && !readOnly} storageKey="turnqa_gs_manager_review_v1">
        <div style={{ marginBottom: 10 }}>
          For any photo that needs fixing, check <b>Needs fix</b>. Then type your note in <b>English</b>.
        </div>
        <div style={{ marginBottom: 10 }}>
          If your cleaner speaks Spanish, click <b>Translate → ES</b> so the cleaner receives Spanish. If your cleaner
          speaks English, just leave it in English (no need to translate).
        </div>
        <div>
          When you&apos;re done, click <b>🛠️ Send Needs Fix</b> to notify the cleaner.
        </div>
      </GettingStartedModal>

      {/* 🕘 Turn History Modal */}
      {historyOpen && (
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
          onClick={() => setHistoryOpen(false)}
        >
          <div
            style={{
              ...ui.card,
              maxWidth: 900,
              width: '100%',
              maxHeight: '85vh',
              display: 'flex',
              flexDirection: 'column',
              overflow: 'hidden',
            }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'start', gap: 12 }}>
              <div>
                <h2 style={{ margin: 0 }}>Turn History</h2>
                <div style={{ ...ui.subtle, marginTop: 6 }}>Events + manager/cleaner notes for this turn</div>
              </div>

              <button type="button" onClick={() => setHistoryOpen(false)} style={ui.btnSecondary} aria-label="Close">
                ✕
              </button>
            </div>

            <div style={{ marginTop: 12, overflowY: 'auto', paddingRight: 6 }}>
              {historyLoading ? (
                <div style={ui.muted}>Loading history…</div>
              ) : historyErr ? (
                <div style={{ color: '#fca5a5' }}>{historyErr}</div>
              ) : historyItems.length === 0 ? (
                <div style={ui.muted}>No history items yet.</div>
              ) : (
                <div style={{ display: 'grid', gap: 10 }}>
                  {historyItems.map((it, idx) => {
                    const isMsg = it?.type === 'message';
                    const who = isMsg ? (it.actor === 'manager' ? 'Manager' : 'Cleaner') : 'Event';

                    const parts = isMsg ? getHistoryMessageParts(it) : null;

                    return (
                      <div
                        key={it.id ? `ev:${it.id}` : `h:${idx}`}
                        style={{
                          border: '1px solid #334155',
                          borderRadius: 12,
                          padding: 10,
                          background: '#0b1220',
                        }}
                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 10, flexWrap: 'wrap' }}>
                          <div style={{ fontWeight: 800 }}>
                            {who}
                            {' — '}
                            <span style={{ color: '#93c5fd' }}>{String(it.event || '')}</span>
                          </div>
                          <div style={{ fontSize: 12, color: '#94a3b8' }}>
                            {it.at ? new Date(it.at).toLocaleString() : ''}
                          </div>
                        </div>

                        {!isMsg && it.text ? (
                          <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{it.text}</div>
                        ) : null}

                        {isMsg ? (
                          <div style={{ marginTop: 8 }}>
                            {parts?.showSent ? block('Sent (what receiver saw)', parts.sent, langChip(parts.sentLang)) : null}
                            {parts?.showOriginal ? block('Original (what sender wrote)', parts.original, langChip(parts.originalLang)) : null}
                            {parts?.showTranslated ? block('Translated', parts.translated, langChip(parts.translatedLang)) : null}

                            {!parts?.showSent && !parts?.showOriginal && !parts?.showTranslated && it.text ? (
                              <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', color: '#cbd5e1' }}>{it.text}</div>
                            ) : null}
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <a href={backHref} style={{ ...ui.btnSecondary, textDecoration: 'none' }}>
              ← Back to turns
            </a>
            <div style={{ fontSize: 12, color: '#94a3b8' }}>
              Turn ID: <code style={{ userSelect: 'all' }}>{turnId}</code>
            </div>
          </div>

          {isManagerMode && (
            <div style={{ marginTop: 16 }}>
              <h2 style={{ margin: 0, fontSize: 25, color: '#f8fafc' }}>
                {propertyLabel || 'Property review'}
              </h2>
              <div style={{ color: '#cbd5e1', fontSize: 13, marginTop: 6 }}>
                {formattedTurnDate ? `Turn date: ${formattedTurnDate}` : (propertyLabel ? 'Turn review' : 'Property name unavailable from current turn response')}
              </div>
            </div>
          )}
          <h2 style={{ marginTop: 12, marginBottom: 6 }}>
            Review Photos
            <span style={{ marginLeft: 10, verticalAlign: 'middle' }}>
              <span style={badgeStyle(status)}>{(status || '—').replace('_', ' ')}</span>
            </span>
          </h2>

          {!isManagerMode && (
            <div
              style={{
                marginTop: 8,
                padding: '8px 10px',
                background: '#0b1220',
                border: '1px solid #334155',
                borderRadius: 10,
                color: '#cbd5e1',
                fontSize: 13,
              }}
            >
              Read-only manager controls hidden. If your manager asked for fixes, use the “Fix & resubmit” box below.
            </div>
          )}

           {hasCorrectionHistory && (
             <div style={{ marginTop: 18, padding: '18px 20px', border: '1px solid #3b82f6', borderRadius: 14, background: 'rgba(30, 64, 120, 0.28)', boxShadow: 'inset 0 0 0 1px rgba(147,197,253,0.08)' }}>
               <div style={{display:'flex',justifyContent:'space-between',alignItems:'flex-start',gap:12,flexWrap:'wrap'}}>
                 <div>
                   <div style={{fontSize:12,color:'#93c5fd',fontWeight:800,letterSpacing:'.07em',textTransform:'uppercase'}}>{isCorrectionReview ? 'Manager action required' : status === 'needs_fix' ? 'Awaiting cleaner' : 'Correction history'}</div>
                   <h3 style={{margin:'5px 0 7px',fontSize:20,color:'#f8fafc'}}>Correction Review</h3>
                   <div style={{color:'#cbd5e1',lineHeight:1.5}}>
                     {isCorrectionReview ? 'Review the latest replacement photo for each outstanding issue. Accept a satisfactory fix, or request another photo with specific feedback.' : status === 'needs_fix' ? 'The cleaner has been asked to submit another correction. Previous attempts and feedback are below.' : 'Review the recorded correction attempts and decisions below.'}
                   </div>
                 </div>
                 <span style={{background:'#172554',border:'1px solid #3b82f6',color:'#bfdbfe',padding:'6px 10px',borderRadius:999,fontSize:12,fontWeight:800}}>
                   {taskIds.size} outstanding {taskIds.size === 1 ? 'issue' : 'issues'}
                 </span>
               </div>
               {isCorrectionReview && unresolvedTaskCount > 0 && <div style={{color:'#fca5a5',marginTop:12}}>{unresolvedTaskCount} issue(s) have no identifiable replacement photo. Approval is blocked until resolved.</div>}
               <div style={{ marginTop: 18, display: 'grid', gap: 12 }}>
                 {correctionGroups.map(group => {
                   const latestAttempt = group.attempts[group.attempts.length - 1];
                   const latestPhoto = group.latest || latestAttempt?.photo || null;
                   const latestIsPending = isCorrectionReview && !!group.finding && !!group.latest && !decidedPhotoIds.has(String(group.latest.id));
                   const latestDecision = latestAttempt?.decision;
                   const groupStatus = latestIsPending ? 'Review needed' : status === 'needs_fix' && group.finding ? 'Awaiting cleaner' : latestDecision?.decision === 'accepted' ? 'Accepted' : group.finding ? 'Outstanding' : 'History';
                   const groupColor = groupStatus === 'Accepted' ? '#86efac' : groupStatus === 'Review needed' ? '#93c5fd' : '#fcd34d';
                   return (
                     <details key={group.taskId} open={!!group.finding} style={{ border: '1px solid #475569', borderRadius: 12, background: '#0b1220', padding: 12 }}>
                       <summary style={{ cursor: 'pointer', color: '#bfdbfe', fontWeight: 800, fontSize: 16 }}>
                         Correction {group.index + 1} — {group.area}
                         <span style={{ color: groupColor, fontSize: 12, marginLeft: 10 }}>{groupStatus}</span>
                       </summary>
                       <div style={{ marginTop: 14 }}>
                         {group.original && (
                           <details style={{ border: '1px solid #334155', borderRadius: 10, padding: 10, marginBottom: 12 }}>
                             <summary style={{ cursor: 'pointer', color: '#cbd5e1', fontWeight: 700 }}>Original flagged photo · View</summary>
                             <a href={group.original.url} target="_blank" rel="noreferrer">
                               <TurnPhotoPreview photo={group.original} alt="Original flagged photo" style={{ width: 220, maxWidth: '100%', borderRadius: 8, marginTop: 10 }} />
                             </a>
                             {group.finding && pickEnglishForManager(group.finding) && (
                               <div style={{ color: '#cbd5e1', marginTop: 8, whiteSpace: 'pre-wrap', fontSize: 13 }}>
                                 <b>Original manager instructions:</b> {pickEnglishForManager(group.finding)}
                               </div>
                             )}
                           </details>
                         )}
                         <div style={{ fontWeight: 800, color: '#e2e8f0', marginBottom: 10 }}>Correction attempts ({group.attempts.length})</div>
                         {group.attempts.map(({photo,decision}, index) => {
                           const isLatest = index === group.attempts.length - 1;
                           const state = decision?.decision === 'accepted' ? 'Accepted' : decision?.decision === 'rejected' ? 'Rejected' : latestIsPending && isLatest ? 'Awaiting review' : 'Submitted';
                           const stateColor = state === 'Accepted' ? '#86efac' : state === 'Rejected' ? '#fca5a5' : '#93c5fd';
                           const showControls = latestIsPending && isLatest && String(group.latest?.id) === String(photo.id);
                           return (
                             <details key={photo.id} open={isLatest} style={{ marginTop: 8, border: showControls ? 'none' : '1px solid #334155', borderRadius: 10, padding: showControls ? 0 : 10 }}>
                               <summary style={{ cursor: 'pointer', fontWeight: 700, color: '#f8fafc' }}>
                                 Attempt {index + 1} <span style={{ color: stateColor, marginLeft: 10 }}>{state}</span>
                                 {isLatest && <span style={{ color: '#93c5fd', marginLeft: 8, fontSize: 12 }}>· Latest</span>}
                               </summary>
                               <div style={{ marginTop: 10, display: showControls ? 'none' : 'flex', gap: 12, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                                 {!showControls && <a href={photo.url} target="_blank" rel="noreferrer"><TurnPhotoPreview photo={photo} alt={'Correction attempt ' + (index + 1)} style={{ width: 220, maxWidth: '100%', borderRadius: 8 }} /></a>}
                                 <div style={{ flex: 1, minWidth: 180, fontSize: 13, lineHeight: 1.5 }}>
                                   <div style={{ color: '#94a3b8' }}>{photo.created_at ? new Date(photo.created_at).toLocaleString() : ''}</div>
                                   {photo.cleaner_note && <div style={{ marginTop: 6 }}><b>Cleaner note:</b> {photo.cleaner_note}</div>}
                                   {(decision?.note_sent || decision?.note) && <div style={{ marginTop: 6, color: '#fde68a' }}><b>Manager feedback:</b> {decision.note_sent || decision.note}</div>}
                                 </div>
                               </div>
                               {showControls && (
                                 <div style={{ marginTop: 10, padding: 0, background: 'transparent' }}>
                                   <PhotoCard
                                     p={photo}
                                     readOnly={readOnly}
                                     originalFlagged={originalFlaggedPhotoIds.has(String(photo.id))}
                                     isManagerMode={isManagerMode}
                                     selectedKeys={selectedKeys}
                                     notesByKey={notesByKey}
                                     findingsByKey={findingsByKey}
                                     setNoteFor={setNoteFor}
                                     toggleKey={toggleKey}
                                     onTranslate={onTranslate}
                                     translateBusyByKey={translateBusyByKey}
                                     allowSelection={false}
                                     acceptedTaskIds={acceptedTaskIds}
                                     correctionDecisionByPhotoId={correctionDecisionByPhotoId}
                                     correctionAttemptByPhotoId={correctionAttemptByPhotoId}
                                     showDecisionEditor={true}
                                   />
                                   <div style={{ marginTop: 10, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                                     <button type="button" disabled={decisionBusy || acting} onClick={() => decideCorrection(group.latest, 'accepted')} style={{ ...ui.btnPrimary, background: '#065f46', border: '1px solid #10b981', color: '#ecfdf5', fontWeight: 800 }}>✓ Accept Fix</button>
                                     <button type="button" disabled={decisionBusy || acting} onClick={() => decideCorrection(group.latest, 'rejected')} style={{ ...ui.btnSecondary, border: '1px solid #d97706', color: '#fde68a', background: '#422006', fontWeight: 800 }}>↻ Request Another Fix</button>
                                   </div>
                                 </div>
                               )}
                             </details>
                           );
                         })}
                         {latestIsPending && !group.attempts.some(a => String(a.photo.id) === String(group.latest.id)) && (
                           <div style={{ marginTop: 12, color: '#fca5a5' }}>Latest correction photo is not yet linked to this history. Review is blocked until the photo appears in the correction timeline.</div>
                         )}
                         {status === 'needs_fix' && group.finding && <div style={{ color: '#fcd34d', marginTop: 12, fontWeight: 700 }}>Next attempt — awaiting cleaner upload</div>}
                         {isCorrectionReview && group.finding && !latestPhoto && <div style={{ color: '#fca5a5', marginTop: 12 }}>No correction photo linked to this issue yet.</div>}
                       </div>
                     </details>
                   );
                 })}
               </div>
               <div style={{marginTop:14,display:'flex',alignItems:'center',gap:12,flexWrap:'wrap'}}>
                 {isCorrectionReview && <button type="button" style={{...ui.btnSecondary,background:'#172554',border:'1px solid #60a5fa',color:'#dbeafe',fontWeight:700}} onClick={() => setViewFullTurn(v => !v)}>
                   {viewFullTurn ? '← Hide Full Photo Gallery' : 'View Full Turn & Photo History'}
                 </button>}
                 <span style={{color:'#94a3b8',fontSize:12}}>{viewFullTurn ? 'Showing all photos for reference.' : isCorrectionReview ? 'All correction photos and review actions are grouped above.' : 'Expand a correction above to view its history.'}</span>
               </div>
             </div>
           )}
           <div style={{ ...ui.subtle, marginTop: 10 }}>Click any photo to open full-size in a new tab.</div>
        </div>

        {(!isCorrectionReview || viewFullTurn) && <div style={ui.card}>
                     {loading ? (
            <div>Loading photos…</div>
          ) : sections && sections.length > 0 ? (
            sections.map((sec) => (
              <div key={sec.key} style={sectionWrapStyle}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'baseline',
                    justifyContent: 'space-between',
                    margin: '4px 4px 16px',
                  }}
                >
                  <h3 style={{ margin: 0 }}>{sec.title || 'Section'}</h3>
                  <div style={{ fontSize: 12, color: '#94a3b8' }}>
                    {sec.photos.length} photo{sec.photos.length === 1 ? '' : 's'}
                  </div>
                </div>

                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12 }}>
                  {sec.photos.map((p) => (
                    <div key={keyFor(p)}>
                    <RequiredPhotoWithHistory
                      key={keyFor(p)}
                      photo={p}
                      history={galleryHistoryByPhotoId.get(String(p.id)) || []}
                      cardProps={{
                      readOnly: readOnly,
                      originalFlagged: originalFlaggedPhotoIds.has(String(p.id)),
                      isManagerMode: isManagerMode,
                      selectedKeys: selectedKeys,
                      notesByKey: notesByKey,
                      findingsByKey: findingsByKey,
                      setNoteFor: setNoteFor,
                      toggleKey: toggleKey,
                      onTranslate: onTranslate,
                      translateBusyByKey: translateBusyByKey,
                      allowSelection: !readOnly && !isCorrectionReview && !p.is_fix,
                      acceptedTaskIds: acceptedTaskIds,
                      correctionDecisionByPhotoId: correctionDecisionByPhotoId,
                      correctionAttemptByPhotoId: correctionAttemptByPhotoId,
                      showDecisionEditor:false
                      }}
                    />
                    {false && isCorrectionReview && latestCorrections.some(x => x.id === p.id) && (
                      <div style={{marginTop:10,padding:10,border:'1px solid #334155',borderRadius:10,background:'rgba(15,23,42,.8)',display:'flex',gap:8,flexWrap:'wrap'}}>
                        {decidedPhotoIds.has(String(p.id)) ? (
                          <strong style={{color:correctionDecisions.some(d => String(d.photo_id) === String(p.id) && d.decision === 'accepted') ? '#86efac' : '#fcd34d'}}>
                            {correctionDecisions.some(d => String(d.photo_id) === String(p.id) && d.decision === 'accepted') ? '✓ Accepted' : '↻ Another fix requested'}
                          </strong>
                        ) : (
                          <>
                            <button type="button" disabled={decisionBusy || acting} onClick={() => decideCorrection(p,'accepted')} style={{...ui.btnPrimary,background:'#065f46',border:'1px solid #10b981',color:'#ecfdf5',fontWeight:800}}>✓ Accept Fix</button>
                            <button type="button" disabled={decisionBusy || acting} onClick={() => decideCorrection(p,'rejected')} style={{...ui.btnSecondary,border:'1px solid #d97706',color:'#fde68a',background:'#422006',fontWeight:800}}>↻ Request Another Fix</button>
                          </>
                        )}
                      </div>
                    )}
                    </div>
                  ))}
                </div>
              </div>
            ))
                     ) : galleryPhotos && galleryPhotos.length > 0 ? (
            (() => {
              // Fallback: group by area_key so managers still see everything
                             const byArea = (galleryPhotos || []).reduce((acc, p) => {
                const k = (p.area_key || '').trim() || '__UNCAT__';
                (acc[k] ||= []).push(p);
                return acc;
              }, {});
              Object.values(byArea).forEach((list) =>
                list.sort((a, b) => new Date(b.created_at) - new Date(a.created_at))
              );
              const areas = Object.keys(byArea)
                .filter((k) => k !== '__UNCAT__')
                .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
                .concat(byArea.__UNCAT__ ? ['__UNCAT__'] : []);

              return areas.map((areaKey) => (
                <div key={areaKey} style={sectionWrapStyle}>
                  <div
                    style={{
                      display: 'flex',
                      alignItems: 'baseline',
                      justifyContent: 'space-between',
                      margin: '2px 4px 10px',
                    }}
                  >
                    <h3 style={{ margin: 0 }}>{areaKey === '__UNCAT__' ? 'Additional uploads' : areaKey}</h3>
                    <div style={{ fontSize: 12, color: '#94a3b8' }}>
                      {byArea[areaKey].length} photo{byArea[areaKey].length === 1 ? '' : 's'}
                    </div>
                  </div>

                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12 }}>
                    {byArea[areaKey].map((p) => (
                      <div key={keyFor(p)}><RequiredPhotoWithHistory
                        key={keyFor(p)}
                        photo={p}
                        history={galleryHistoryByPhotoId.get(String(p.id)) || []}
                        cardProps={{
                      readOnly: readOnly,
                      originalFlagged: originalFlaggedPhotoIds.has(String(p.id)),
                        isManagerMode: isManagerMode,
                        selectedKeys: selectedKeys,
                        notesByKey: notesByKey,
                        findingsByKey: findingsByKey,
                        setNoteFor: setNoteFor,
                        toggleKey: toggleKey,
                        onTranslate: onTranslate,
                        translateBusyByKey: translateBusyByKey,
                       allowSelection: !readOnly && !isCorrectionReview && !p.is_fix,
                       acceptedTaskIds: acceptedTaskIds,
                       correctionDecisionByPhotoId: correctionDecisionByPhotoId,
                      correctionAttemptByPhotoId: correctionAttemptByPhotoId,
                       showDecisionEditor:false
                       }}
                      />
                      {false && isCorrectionReview && latestCorrections.some(x => x.id === p.id) && !decidedPhotoIds.has(String(p.id)) && <div style={{display:'flex',gap:8,marginTop:8}}><button type="button" disabled={decisionBusy} onClick={() => decideCorrection(p,'accepted')} style={{...ui.btnPrimary,background:'#065f46',border:'1px solid #10b981',color:'#ecfdf5',fontWeight:800}}>✓ Accept Fix</button><button type="button" disabled={decisionBusy} onClick={() => decideCorrection(p,'rejected')} style={{...ui.btnSecondary,border:'1px solid #d97706',color:'#fde68a',background:'#422006',fontWeight:800}}>↻ Request Another Fix</button></div>}
                      </div>
                    ))}
                  </div>
                </div>
              ));
            })()
          ) : (
            <div style={ui.muted}>No photos yet.</div>
          )}
        </div>}

          {isManagerMode && (
            <div
              style={{
                margin: '12px 0 6px',
                padding: 12,
                border: '1px solid #334155',
                borderRadius: 12,
                background: '#0f172a',
              }}
            >
              <h3 style={{ margin: 0, fontSize: 19, color: '#f8fafc' }}>Overall Turn Conversation</h3>
              <p style={{ margin: '6px 0 12px', color: '#94a3b8', fontSize: 13 }}>General messages about this turnover. Notes about an individual photo belong with that photo.</p>
              {loadErr && <div style={{ color: '#fca5a5' }}>{loadErr}</div>}

              {lastCleanerNote && (
                <div
                  style={{
                    marginTop: 10,
                    padding: 12,
                    borderRadius: 8,
                    border: '1px solid #065f46',
                    background: '#052e2b',
                    color: '#86efac',
                    boxShadow: '0 0 0 3px rgba(5,150,105,0.20) inset',
                  }}
                >
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
                  <div style={{ whiteSpace: 'pre-wrap' }}>{lastCleanerNote}</div>
                </div>
              )}

              {!readOnly ? <div style={{ marginTop: 10 }}>
                <div
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 10,
                    marginBottom: 6,
                  }}
                >
                  <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af' }}>
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
                      opacity: summaryBusy || !String(summaryNote.original || '').trim() ? 0.6 : 1,
                    }}
                    title="Translate English → Spanish"
                  >
                    {summaryBusy ? 'Translating…' : 'Translate → ES'}
                  </button>
                </div>

                <textarea
                  value={summaryNote.original}
                  onChange={(e) => setSummaryNote((prev) => ({ ...prev, original: e.target.value, sourceLang: 'en' }))}
                  rows={3}
                  placeholder="Write your summary in English…"
                  style={{
                    ...ui.input,
                    width: '100%',
                    padding: '10px 12px',
                    resize: 'vertical',
                    background: '#0b1220',
                  }}
                />

                <div style={{ fontSize: 12, fontWeight: 700, color: '#9ca3af', margin: '10px 0 6px' }}>
                  Translated (ES) — sent to cleaner
                </div>

                <textarea
                  value={summaryNote.translated}
                  onChange={(e) => setSummaryNote((prev) => ({ ...prev, translated: e.target.value, targetLang: 'es' }))}
                  rows={3}
                  placeholder="Spanish will appear here… (editable)"
                  style={{
                    ...ui.input,
                    width: '100%',
                    padding: '10px 12px',
                    resize: 'vertical',
                    background: '#0b1220',
                  }}
                />

                <div style={{ marginTop: 6, fontSize: 11, color: '#64748b' }}>
                  Tip: If you change the English above, click Translate again to refresh the Spanish.
                </div>
              </div>

              : <div style={{ marginTop: 12, color: '#94a3b8', fontSize: 13 }}>
                  This approved turnover is read-only. Its photos, notes, and correction history are preserved.
                  {!!summaryNote.original && <div style={{ marginTop: 10, whiteSpace: 'pre-wrap', color: '#cbd5e1' }}><b>Manager summary (EN):</b> {summaryNote.original}</div>}
                  {!!summaryNote.translated && <div style={{ marginTop: 8, whiteSpace: 'pre-wrap', color: '#cbd5e1' }}><b>Manager summary (ES):</b> {summaryNote.translated}</div>}
                </div>}

              <div style={{ display: 'flex', gap: 10, marginTop: 12, flexWrap: 'wrap' }}>
                {!isCorrectionReview && status === 'submitted' && <button
                  onClick={sendNeedsFix}
                  disabled={acting || !turnId}
                  style={{
                    ...ui.btnSecondary,
                    border: '1px solid #d97706',
                    background: '#4a2f04',
                    color: '#fcd34d',
                  }}
                >
                  {acting ? '…' : '🛠️ Send Needs Fix (with notes)'}
                </button>}



                <button type="button" onClick={openHistory} disabled={!turnId} style={ui.btnSecondary}>
                  🕘 View History
                </button>
              </div>
            </div>
          )}

        {isManagerMode && !readOnly && (
          <div style={{ ...ui.card, marginTop: 16, border: '1px solid #334155' }}>
            <h3 style={{ margin: '0 0 8px', fontSize: 19 }}>Final Turn Approval</h3>
            <p style={{ color: '#94a3b8', fontSize: 13, marginTop: 0 }}>Approve the entire turnover after all required corrections have been accepted.</p>
            <button onClick={markApproved} disabled={acting || !turnId || status !== 'submitted' || (activeFindings.length > 0 && !allCorrectionsAccepted)} style={{...ui.btnPrimary, opacity: (acting || !turnId || status !== 'submitted' || (activeFindings.length > 0 && !allCorrectionsAccepted)) ? 0.4 : 1, cursor: (acting || !turnId || status !== 'submitted' || (activeFindings.length > 0 && !allCorrectionsAccepted)) ? 'not-allowed' : 'pointer'}}>
              {acting ? '…' : '✅ Approve Turn'}
            </button>
            {activeFindings.length > 0 && !allCorrectionsAccepted && <div style={{color:'#fcd34d',fontSize:12,marginTop:8}}>Accept every outstanding correction before approving the entire turn.</div>}
          </div>
        )}
        {uniqueAreas.length > 1 && <div style={{ ...ui.subtle }}>Areas in this turn: {uniqueAreas.join(' • ')}</div>}
      </section>
    </ChromeDark>
  );
}
