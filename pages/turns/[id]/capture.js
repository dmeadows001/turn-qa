// pages/turns/[id]/capture.js
import { useRouter } from 'next/router';
import { useEffect, useMemo, useState } from 'react';

// --- If you already define REQUIRED_AREAS elsewhere, you can remove this block ---
const REQUIRED_AREAS = [
  { key: 'entry_overall', label: 'Entry - Overall' },
  { key: 'living_overall', label: 'Living - Overall' },
  { key: 'living_under_tables', label: 'Living - Under Tables' },
  { key: 'kitchen_overall', label: 'Kitchen - Overall' },
  { key: 'bathroom_overall', label: 'Bathroom - Overall' },
  { key: 'bedroom_overall', label: 'Bedroom - Overall' }
];
// -------------------------------------------------------------------------------

export default function Capture() {
  const { query } = useRouter();
  const turnId = query.id;

  // Uploaded files grouped by area: { [areaKey]: [{name,url,width,height,areaKey}, ...] }
  const [uploadsByArea, setUploadsByArea] = useState({});
  // Big combined “AI Findings” list
  const [aiFlags, setAiFlags] = useState([]);
  // NEW: per-photo AI flags map: { [storagePath]: issues[] }
  const [aiByPath, setAiByPath] = useState({});
  const [submitting, setSubmitting] = useState(false);

  // -------- helpers --------
  const sevStyle = (s='info') => ({
    display:'inline-block',
    padding:'2px 6px',
    borderRadius:8,
    fontSize:12,
    marginRight:6,
    background: s==='fail' ? '#FEE2E2' : s==='warn' ? '#FFF4E5' : '#EEF2FF',
    color: s==='fail' ? '#991B1B' : s==='warn' ? '#9A5B00' : '#334155'
  });

  // Get image dimensions in browser (reads EXIF-rotated size correctly)
  async function getDims(file) {
    return await new Promise((resolve, reject) => {
      const img = new Image();
      img.onload = () => {
        resolve({ width: img.naturalWidth, height: img.naturalHeight });
        URL.revokeObjectURL(img.src);
      };
      img.onerror = reject;
      img.src = URL.createObjectURL(file);
    });
  }

  // -------- add files (captures width/height, enforces quality, uploads to Storage) --------
  async function addFiles(areaKey, fileList) {
    const files = Array.from(fileList || []);
    const uploaded = [];

    for (const f of files) {
      const dims = await getDims(f);
      const longest = Math.max(dims.width, dims.height);
      const tooSmall = longest < 1024;
      const tooBig = f.size > 6 * 1024 * 1024; // > 6MB

      if (tooSmall || tooBig) {
        alert(
          `Rejected "${f.name}": ` +
          (tooSmall ? `min longest side is 1024px (got ${dims.width}×${dims.height}). ` : '') +
          (tooBig ? `file > 6MB.` : '')
        );
        continue;
      }

      // Ask server for a signed upload URL + storage path
      const up = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, areaKey, filename: f.name, mime: f.type })
      }).then(r => r.json());

      if (!up.uploadUrl || !up.path) {
        alert('Could not get upload URL; try again.');
        continue;
      }

      // Upload file to Storage with the signed URL
      await fetch(up.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': up.mime || 'application/octet-stream' },
        body: f
      });

      uploaded.push({
        name: f.name,
        areaKey,
        url: up.path,        // e.g. "turns/<uuid>/<areaKey>/<filename>.jpg" (no leading "photos/")
        width: dims.width,
        height: dims.height
      });
    }

    if (uploaded.length) {
      setUploadsByArea(prev => ({
        ...prev,
        [areaKey]: [ ...(prev[areaKey] || []), ...uploaded ]
      }));
    }
  }

  // -------- AI pre-check: rules + real vision scan, then fill UI state --------
  async function runPrecheck() {
    const localFlags = [];
    const MIN_LONGEST = 1024;

    // local quality checks (resolution)
    Object.entries(uploadsByArea).forEach(([area, files]) => {
      files.forEach(f => {
        const longest = Math.max(f.width || 0, f.height || 0);
        if (longest && longest < MIN_LONGEST) {
          localFlags.push(`Low-resolution in ${area}: ${f.name} (${f.width}×${f.height})`);
        }
      });
    });

    // rules-based (min counts, filename keywords)
    const ruleResp = await fetch('/api/vision-precheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadsByArea })
    }).then(r => r.json()).catch(() => ({ flags: [] }));

    // real AI scan (OpenAI Vision)
    const aiResp = await fetch('/api/vision-scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadsByArea })
    }).then(r => r.json()).catch(() => ({ results: [], error: 'network' }));

    // per-photo map for rendering under each thumbnail
    const perPhoto = {};
    (aiResp.results || []).forEach(r => {
      perPhoto[r.path] = Array.isArray(r.issues) ? r.issues : [];
    });
    setAiByPath(perPhoto);

    // flatten to lines for the “AI Findings” list
    const aiLines = [];
    (aiResp.results || []).forEach(r => {
      (r.issues || []).forEach(issue => {
        const sev = (issue.severity || 'info').toUpperCase();
        const conf = typeof issue.confidence === 'number' ? ` (${Math.round(issue.confidence * 100)}%)` : '';
        aiLines.push(`${sev} in ${r.area_key || 'unknown'}: ${issue.label}${conf}`);
      });
    });
    if (aiResp.error) aiLines.unshift(`AI check notice: ${aiResp.error}`);

    setAiFlags([ ...(ruleResp.flags || []), ...localFlags, ...aiLines ]);
  }

  // -------- submit all photos (writes rows + marks turn submitted) --------
  async function submitAll() {
    setSubmitting(true);
    const photos = Object.values(uploadsByArea).flat();
    const resp = await fetch('/api/submit-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId, photos })
    });
    setSubmitting(false);

    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      alert('Submit failed: ' + (err.error || resp.statusText));
      return;
    }
    alert('Submitted! (MVP)');
  }

  // ---------- UI ----------
  if (!turnId) return <div style={{ padding:24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 960, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {turnId} — Cleaner Capture</h1>
      <p style={{ color:'#555' }}>
        Upload clear photos for each area. Longest side ≥ 1024px, ≤ 6MB. Run AI Pre-Check before submitting.
      </p>

      {REQUIRED_AREAS.map(area => {
        const files = uploadsByArea[area.key] || [];
        return (
          <div key={area.key} style={{ border:'1px solid #eee', borderRadius:12, padding:12, margin:'12px 0' }}>
            <div style={{ display:'flex', justifyContent:'space-between', alignItems:'center' }}>
              <b>{area.label}</b>
              <input
                type="file"
                accept="image/*"
                multiple
                onChange={(e) => addFiles(area.key, e.target.files)}
              />
            </div>

            {/* simple list of current uploads for this area */}
            {files.length > 0 && (
              <div style={{ marginTop:10, display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(220px,1fr))', gap:10 }}>
                {files.map(f => (
                  <div key={f.url} style={{ border:'1px solid #eee', borderRadius:10, padding:8 }}>
                    <div style={{ fontSize:13, marginBottom:6 }}>
                      <b title={f.name}>{f.name}</b><br/>
                      {f.width}×{f.height}
                    </div>

                    {/* Per-photo AI flags */}
                    {Array.isArray(aiByPath[f.url]) && aiByPath[f.url].length > 0 && (
                      <div>
                        {aiByPath[f.url].map((iss, idx) => (
                          <div key={idx} style={{ marginBottom:4 }}>
                            <span style={sevStyle(iss.severity)}>{(iss.severity || 'info').toUpperCase()}</span>
                            <span style={{ fontSize:13 }}>
                              {iss.label}
                              {typeof iss.confidence === 'number'
                                ? ` (${Math.round(iss.confidence * 100)}%)`
                                : ''}
                            </span>
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        );
      })}

      {/* AI findings summary */}
      <div style={{ border:'1px dashed #cbd5e1', borderRadius:12, padding:12, marginTop:16 }}>
        <div style={{ fontWeight:600, marginBottom:8 }}>AI Findings</div>
        {aiFlags.length === 0 ? (
          <div style={{ color:'#64748b' }}>No findings yet — click “Run AI Pre-Check”.</div>
        ) : (
          <ul style={{ marginLeft:18 }}>
            {aiFlags.map((f, i) => <li key={i}>{f}</li>)}
          </ul>
        )}
      </div>

      <div style={{ display:'flex', gap:12, marginTop:16 }}>
        <button onClick={runPrecheck} style={{ padding:'10px 14px' }}>
          🔎 Run AI Pre-Check
        </button>
        <button onClick={submitAll} disabled={submitting} style={{ padding:'10px 14px', opacity: submitting ? 0.6 : 1 }}>
          ✅ Submit Turn
        </button>
      </div>
    </div>
  );
}
