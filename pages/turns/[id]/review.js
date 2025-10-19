// pages/turns/[id]/review.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useRef, useState } from 'react';
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
  return (j.photos || []).map(p => ({
    id: p.id,
    area_key: p.area_key || '',
    created_at: p.created_at,
    url: p.signedUrl || '',
    path: p.path || ''
  }));
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

// Highlight style for flagged photos
const flaggedCardStyle = {
  border: '1px solid #d97706',
  boxShadow: '0 0 0 3px rgba(217,119,6,0.25) inset',
  background: '#0b1220'
};

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
  const [loading, setLoading] = useState(true);
  const [loadErr, setLoadErr] = useState('');

  // Manager notes (top-level summary) + per-photo selections/notes
  const [managerNote, setManagerNote] = useState('');
  const [acting, setActing] = useState(false);

  // Per-photo state:
  const [notesByPath, setNotesByPath] = useState({});          // { [path]: string }
  const [selectedPaths, setSelectedPaths] = useState(new Set()); // Set<string>

  // Findings for highlight + prefill
  const [findingsByPath, setFindingsByPath] = useState({});    // { [path]: {note, severity?} }

  // Cleaner “fix & resubmit” state
  const [cleanerReply, setCleanerReply] = useState('');
  const [staged, setStaged] = useState([]); // [{name, preview, path, area_key?}]
  const [uploadingFix, setUploadingFix] = useState(false);
  const [submittingFixes, setSubmittingFixes] = useState(false);
  const fileInputRef = useRef(null);

  useEffect(() => {
    if (!turnId) return;
    (async () => {
      setLoading(true);
      setLoadErr('');
      try {
        const [t, ph] = await Promise.all([fetchTurn(turnId), fetchPhotos(turnId)]);
        setTurn(t);
        setStatus(t?.status || 'in_progress');

        // grab any cleaner note field the API returned on the turn row
        const cleanerNote =
          t?.cleaner_note ?? t?.cleaner_reply ?? t?.cleaner_message ?? '';
        setCleanerReply(''); // (this state is for the cleaner form; just keeping it clean)

        // BUGFIX: server uses `manager_note` (singular)
        setManagerNote(t?.manager_note || '');

        setPhotos(ph);

        // Load findings and prefill
        const f = await fetchFindings(turnId);
        if (f.length) {
          const map = {};
          const sel = new Set();
          const notes = {};
          f.forEach(it => {
            if (!it?.path) return;
            map[it.path] = { note: it.note || '', severity: it.severity || 'warn' };
            sel.add(it.path);
            notes[it.path] = it.note || '';
          });
          setFindingsByPath(map);
          if (isManagerMode) setSelectedPaths(sel); // managers see the boxes pre-checked
          setNotesByPath(prev => ({ ...notes, ...prev }));
        } else {
          setFindingsByPath({});
        }
      } catch (e) {
        setLoadErr(e.message || 'load failed');
      } finally {
        setLoading(false);
      }
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [turnId, isManagerMode]);

  // Cleanup local object URLs
  useEffect(() => {
    return () => { staged.forEach(s => s.preview && URL.revokeObjectURL(s.preview)); };
  }, [staged]);

  const uniqueAreas = useMemo(() => {
    const set = new Set((photos || []).map(p => p.area_key).filter(Boolean));
    return Array.from(set);
  }, [photos]);

  // --- Helpers to toggle/check per-photo selection ---
  function togglePath(path) {
    setSelectedPaths(prev => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  }
  function setNote(path, text) {
    setNotesByPath(prev => ({ ...prev, [path]: text }));
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
      const selected = new Set(selectedPaths);
      const payloadNotes = [];

      photos.forEach(p => {
        const path = p.path || '';
        const note = (notesByPath[path] || '').trim();
        if (selected.has(path) || note.length > 0) {
          payloadNotes.push({ path, note });
        }
      });

      if (payloadNotes.length === 0 && !managerNote.trim()) {
        alert('Select at least one photo or add a summary note before sending “Needs fix”.');
        setActing(false);
        return;
      }

      const r = await fetch(`/api/turns/${turnId}/needs-fix`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          notes: payloadNotes,                 // [{ path, note }]
          summary: managerNote?.trim() || null,
          send_sms: true
        })
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Needs-fix failed');

      setStatus('needs_fix');

      // Update local highlight immediately
      const newMap = {};
      const sel = new Set();
      const newNotes = {};
      payloadNotes.forEach(it => {
        newMap[it.path] = { note: it.note || '', severity: 'warn' };
        sel.add(it.path);
        newNotes[it.path] = it.note || '';
      });
      setFindingsByPath(newMap);
      setSelectedPaths(sel);
      setNotesByPath(prev => ({ ...prev, ...newNotes }));

      alert('Marked Needs Fix. Cleaner notified via SMS.');
    } catch (e) {
      alert(e.message || 'Could not send needs-fix.');
    } finally {
      setActing(false);
    }
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  async function addFixFiles(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;

    setUploadingFix(true);
    try {
      const uploaded = [];
      for (const f of files) {
        const preview = URL.createObjectURL(f);

        const meta = await fetch('/api/upload-url', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            turnId,
            shotId: 'fixes',
            filename: f.name,
            mime: f.type || 'image/jpeg'
          })
        }).then(r => r.json());

        if (!meta?.uploadUrl || !meta?.path) {
          URL.revokeObjectURL(preview);
          alert(`Could not get upload URL for ${f.name}; skipping.`);
          continue;
        }

        await fetch(meta.uploadUrl, {
          method: 'PUT',
          headers: { 'Content-Type': meta.mime || f.type || 'application/octet-stream' },
          body: f
        });

        uploaded.push({ name: f.name, preview, path: meta.path });
      }

      if (uploaded.length) setStaged(prev => [...prev, ...uploaded]);
    } finally {
      setUploadingFix(false);
    }
  }

  async function submitFixes() {
    if (!turnId) return;
    if (staged.length === 0 && !cleanerReply.trim()) {
      alert('Add at least one photo or a note before submitting.');
      return;
    }
    setSubmittingFixes(true);
    try {
      const payload = {
        turn_id: turnId,
        reply: cleanerReply || '',
        photos: staged.map(s => ({ path: s.path }))
      };
      const r = await fetch('/api/resubmit-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || 'Resubmit failed');

      staged.forEach(s => s.preview && URL.revokeObjectURL(s.preview));
      setStaged([]);
      setCleanerReply('');
      const ph = await fetchPhotos(turnId);
      setPhotos(ph);
      setStatus('submitted');
      alert('Submitted fixes for review ✅');
    } catch (e) {
      alert(e.message || 'Could not resubmit fixes.');
    } finally {
      setSubmittingFixes(false);
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

        {/* Photos */}
        <div style={ui.card}>
          {loading ? (
            <div>Loading photos…</div>
          ) : photos.length === 0 ? (
            <div style={ui.muted}>No photos yet.</div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(220px,1fr))', gap: 12, marginTop: 4 }}>
              {photos.map(p => {
                const path = p.path || '';
                const selected = selectedPaths.has(path);
                const noteVal = notesByPath[path] || '';
                const flagged = !!findingsByPath[path];

                return (
                  <div
                    key={p.id}
                    style={{
                      border: '1px solid #334155',
                      borderRadius: 12,
                      overflow: 'hidden',
                      background:'#0b1220',
                      ...(flagged ? flaggedCardStyle : null)
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
                        </div>

                        {isManagerMode && (
                          <label style={{ display:'flex', alignItems:'center', gap:6, cursor:'pointer', userSelect:'none' }}>
                            <input
                              type="checkbox"
                              checked={selected}
                              onChange={() => togglePath(path)}
                              style={{ transform:'scale(1.1)' }}
                            />
                            <span>Needs fix</span>
                          </label>
                        )}
                      </div>

                      <div style={{ color: '#9ca3af' }}>{new Date(p.created_at).toLocaleString()}</div>
                      <div style={{ color: '#64748b', overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{p.path}</div>

                      {/* Per-photo note (manager only) */}
                      {isManagerMode && (
                        <div style={{ marginTop:8 }}>
                          <textarea
                            value={noteVal}
                            onChange={e => setNote(path, e.target.value)}
                            rows={2}
                            placeholder="Note for this photo (optional)…"
                            style={{ ...ui.input, width:'100%', padding:'8px 10px', resize:'vertical', background:'#0b1220' }}
                          />
                        </div>
                      )}

                      {/* Cleaner view: show manager note, if any */}
                      {!isManagerMode && flagged && findingsByPath[path]?.note && (
                        <div style={{
                          marginTop:8,
                          padding:'8px 10px',
                          background:'#0f172a',
                          border:'1px solid #334155',
                          borderRadius:8,
                          color:'#cbd5e1'
                        }}>
                          <div style={{ fontSize:11, color:'#94a3b8', marginBottom:4, fontWeight:700 }}>Manager note</div>
                          <div style={{ whiteSpace:'pre-wrap' }}>{findingsByPath[path].note}</div>
                        </div>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Cleaner Fix & Resubmit */}
        {!isManagerMode && (
          <div style={ui.card}>
            <h3 style={{ marginTop:0 }}>Fix & resubmit</h3>
            <p style={ui.muted}>If your manager requested changes, add the new photo(s) and a quick note, then submit for review.</p>

            <div style={{ marginTop: 10 }}>
              <div style={{ fontSize:12, fontWeight:700, color:'#9ca3af', marginBottom:6 }}>Optional note to manager</div>
              <textarea
                value={cleanerReply}
                onChange={e=>setCleanerReply(e.target.value)}
                rows={3}
                placeholder="What did you fix?"
                style={{ ...ui.input, width:'100%', padding:'10px 12px', resize:'vertical', background:'#0b1220' }}
              />
            </div>

            {/* Hidden file input */}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              multiple
              style={{ display:'none' }}
              onChange={(e)=>addFixFiles(e.target.files)}
            />

            <div style={{ display:'flex', gap:10, marginTop:12, flexWrap:'wrap' }}>
              <button onClick={openFilePicker} disabled={uploadingFix} style={ui.btnSecondary}>
                {uploadingFix ? 'Uploading…' : '➕ Add photos'}
              </button>
              <button onClick={submitFixes} disabled={submittingFixes || (staged.length === 0 && !cleanerReply.trim())} style={ui.btnPrimary}>
                {submittingFixes ? 'Submitting…' : '✅ Submit fixes for review'}
              </button>
            </div>

            {staged.length > 0 && (
              <div style={{ marginTop:12 }}>
                <div style={{ fontWeight:700, marginBottom:6 }}>Staged photos (not yet submitted)</div>
                <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(180px,1fr))', gap:12 }}>
                  {staged.map((s, i) => (
                    <div key={i} style={{ border:'1px solid #334155', borderRadius:10, overflow:'hidden', background:'#0b1220' }}>
                      {s.preview ? (
                        <img
                          src={s.preview}
                          alt={s.name}
                          style={{ width:'100%', display:'block', aspectRatio:'4/3', objectFit:'cover' }}
                        />
                      ) : (
                        <div style={{ padding:10, color:'#cbd5e1' }}>{s.name}</div>
                      )}
                      <div style={{ padding:8, fontSize:12, color:'#9ca3af' }}>
                        {s.name}
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        {uniqueAreas.length > 1 && (
          <div style={{ ...ui.subtle }}>
            Areas in this turn: {uniqueAreas.join(' • ')}
          </div>
        )}
      </section>
    </ChromeDark>
  );
}
