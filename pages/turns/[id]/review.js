// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState, memo } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

async function fetchTurn(turnId) {
  const r = await fetch(`/api/get-turn?id=${turnId}`);
  if (!r.ok) throw new Error((await r.json()).error || 'get-turn failed');
  const j = await r.json();
  return j.turn;
}

async function fetchPhotos(turnId) {
  const r = await fetch(`/api/list-turn-photos?id=${turnId}`);
  if (!r.ok) throw new Error((await r.json()).error || 'list-turn-photos failed');
  const j = await r.json();

  // Map and include persisted is_fix/cleaner_note if present (undefined-safe).
  const mapped = (j.photos || []).map(p => ({
    shot_id: p.shot_id || null,
    id: p.id,
    area_key: p.area_key || '',
    created_at: p.created_at,
    url: p.signedUrl || '',
    path: p.path || '',
    is_fix: !!p.is_fix,
    cleaner_note: p.cleaner_note || '',
  }));

  // Dedupe by final resolved storage path to prevent UI duplicates.
  return Array.from(new Map(mapped.map(x => [x.path || '', x])).values());
}

// Load existing findings for this turn: { findings: [{ path, note, severity? }] }
async function fetchFindings(turnId) {
  try {
    const r = await fetch(`/api/turns/${turnId}/findings`);
    if (!r.ok) return [];
    const j = await r.json().catch(() => ({}));
    return Array.isArray(j.findings) ? j.findings : [];
  } catch {
    return [];
  }
}

async function fetchTemplate(turnId) {
  try {
    const r = await fetch(`/api/turn-template?turnId=${turnId}`);
    const j = await r.json().catch(() => ({}));
    const shots = Array.isArray(j.shots) ? j.shots : [];
    return shots.map(s => ({
      shot_id: s.shot_id,
      area_key: s.area_key || '',
      label: s.label || s.area_key || 'Section',
      min_count: s.min_count || 0,
    }));
  } catch {
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


// Stable per-photo key
function keyFor(p) {
  return p && (p.id || `${p.path || ''}#${p.created_at || ''}`);
}

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

  // Manager notes (top-level summary) + per-photo selections/notes
  const [managerNote, setManagerNote] = useState('');
  const [acting, setActing] = useState(false);

  // Per-photo state (keyed by stable key)
  const [notesByKey, setNotesByKey] = useState({});
  const [selectedKeys, setSelectedKeys] = useState(new Set());

  // Findings for highlight + prefill (keyed by photoKey)
  const [findingsByKey, setFindingsByKey] = useState({});

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
          (t && (t.cleaner_note ?? t.cleaner_reply ?? t.cleaner_message)) || '';
        setLastCleanerNote(cleanerNote);
        setCleanerReply('');

        setManagerNote((t && t.manager_note) || '');

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
              map[k] = { note: (it && it.note) || '', severity: (it && it.severity) || 'warn' };
              if (isManagerMode) sel.add(k);
              notes[k] = (it && it.note) || '';
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
  
  function toggleKey(p) {
    const k = keyFor(p);
    setSelectedKeys(prev => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }
  function setNoteFor(p, text) {
    const k = keyFor(p);
    setNotesByKey(prev => ({ ...prev, [k]: text }));
  }

  // --- Approve ---
  async function markApproved() {
    if (!turnId) return;
    setActing(true);
    try {
      const ok = window.confirm('Approve this turn?');
      if (!ok) return;
      const r = await fetch('/api/update-turn-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_id: turnId, new_status: 'approved', manager_note: managerNote || '' })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'update failed');
      setStatus('approved');
      alert('Turn approved ✅');
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
        const note = (notesByKey[k] || '').trim();
        if (selected || note.length > 0) {
          payloadNotes.push({ path: p.path || '', note });
        }
      });

      if (payloadNotes.length === 0 && !(managerNote || '').trim()) {
        alert('Select at least one photo or add a summary note before sending “Needs fix”.');
        setActing(false);
        return;
      }

      const r = await fetch(`/api/turns/${turnId}/needs-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: payloadNotes,                 // [{ path, note }]
          summary: (managerNote || '').trim() || null,
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
          newMap[k] = { note: it.note || '', severity: 'warn' };
          sel.add(k);
          newNotes[k] = it.note || '';
        });
      });
      setFindingsByKey(newMap);
      setSelectedKeys(sel);
      setNotesByKey(prev => ({ ...prev, ...newNotes }));

      alert('Marked Needs Fix. Cleaner notified via SMS.');
    } catch (e) {
      alert(e.message || 'Could not send needs-fix.');
    } finally {
      setActing(false);
    }
  }

  function PhotoCard({ p }) {
  const PhotoCard = memo(function PhotoCard({ p, isManagerMode, selectedKeys, notesByKey, findingsByKey, setNoteFor, toggleKey }) {
  const k = keyFor(p);
  const selected = selectedKeys.has(k);
  const noteVal = notesByKey[k] || '';
  const flagged = !!findingsByKey[k];
  const isFix = !!p.is_fix;

  const styleCard = isFix ? fixCardStyle : (flagged ? flaggedCardStyle : null);

  return (
    <div
      key={p.id || k}
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

        {isManagerMode && (
          <div style={{ marginTop:8 }}>
            <textarea
              value={noteVal}
              onChange={e => setNoteFor(p, e.target.value)}
              rows={2}
              placeholder="Note for this photo (optional)…"
              style={{ ...ui.input, width:'100%', padding:'8px 10px', resize:'vertical', background:'#0b1220' }}
            />
          </div>
        )}

        {isManagerMode && flagged && findingsByKey[k]?.note && (
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
              Manager note (sent to cleaner)
            </div>
            <div style={{ whiteSpace: 'pre-wrap' }}>{findingsByKey[k].note}</div>
          </div>
        )}

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

        {!isManagerMode && flagged && findingsByKey[k] && findingsByKey[k].note && (
          <div style={{
            marginTop:8,
            padding:'8px 10px',
            background:'#0f172a',
            border:'1px solid #334155',
            borderRadius:8,
            color:'#cbd5e1'
          }}>
            <div style={{ fontSize:11, color:'#94a3b8', marginBottom:4, fontWeight:700 }}>Manager note</div>
            <div style={{ whiteSpace:'pre-wrap' }}>{findingsByKey[k].note}</div>
          </div>
        )}
      </div>
    </div>
  );
}, (prev, next) => keyFor(prev.p) === keyFor(next.p));


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
                  marginTop:10,
                  padding:12,
                  border:'1px solid #334155',
                  borderRadius:8,
                  background:'#0b1220',
                  color:'#cbd5e1'
                }}>
                  <div style={{ fontSize:12, fontWeight:700, color:'#9ca3af', marginBottom:6 }}>
                    Cleaner note
                  </div>
                  <div style={{ whiteSpace:'pre-wrap' }}>{lastCleanerNote}</div>
                </div>
              )}

              <div style={{ marginTop:10 }}>
                <div style={{ fontSize:12, fontWeight:700, color:'#9ca3af', marginBottom:6 }}>
                  Optional overall note to cleaner (summary)
                </div>
                <textarea
                  value={managerNote}
                  onChange={e=>setManagerNote(e.target.value)}
                  rows={3}
                  placeholder="Short summary the cleaner can see…"
                  style={{
                    ...ui.input,
                    width:'100%',
                    padding:'10px 12px',
                    resize:'vertical',
                    background:'#0b1220'
                  }}
                />
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
