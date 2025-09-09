import { useRouter } from 'next/router';
import { useState, useMemo } from 'react';
import { REQUIRED_AREAS } from '../../../lib/requiredShots';

export default function Capture() {
  const router = useRouter();
  const { id: turnId } = router.query;

  const [uploadsByArea, setUploadsByArea] = useState({});
  const [aiFlags, setAiFlags] = useState([]);
  const [submitting, setSubmitting] = useState(false);

  const ready = useMemo(() => Boolean(turnId), [turnId]);

  async function addFiles(areaKey, fileList) {
    const files = Array.from(fileList || []);
    const uploaded = [];

    for (const f of files) {
      // 1) ask server for signed upload URL
      const up = await fetch('/api/upload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, areaKey, filename: f.name, mime: f.type })
      }).then(r => r.json());

      if (!up.uploadUrl) continue;

      // 2) upload to Supabase Storage using the signed URL
      await fetch(up.uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': up.mime || 'application/octet-stream' },
        body: f
      });

      // 3) record for submit & precheck
      uploaded.push({ name: f.name, areaKey, url: up.path });
    }

    setUploadsByArea(prev => ({
      ...prev,
      [areaKey]: [ ...(prev[areaKey] || []), ...uploaded ]
    }));
  }

  async function runPrecheck() {
    const resp = await fetch('/api/vision-precheck', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ uploadsByArea })
    }).then(r => r.json());
    setAiFlags(resp.flags || []);
  }

  async function submitAll() {
    setSubmitting(true);
    const photos = Object.values(uploadsByArea).flat();
    await fetch('/api/submit-turn', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ turnId, photos })
    });
    setSubmitting(false);
    alert('Submitted! (MVP)');
  }

  if (!ready) return <div style={{ padding: 24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 980, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {turnId} — Cleaner Capture</h1>
      <p>Upload required shots. Hit “Pre-Check” to catch misses before submit.</p>

      <div style={{ display: 'grid', gap: 16, gridTemplateColumns: 'repeat(auto-fit, minmax(280px, 1fr))', marginTop: 24 }}>
        {REQUIRED_AREAS.map(a => (
          <div key={a.key} style={{ border: '1px solid #eee', borderRadius: 12, padding: 12 }}>
            <b>{a.title}</b> <span style={{ fontSize: 12, color: '#666' }}> (min {a.minPhotos})</span>
            <div style={{ fontSize: 12, color: '#666', marginTop: 4 }}>{a.guidance}</div>

            <div style={{ marginTop: 10 }}>
              <input type="file" accept="image/*" multiple onChange={e => addFiles(a.key, e.target.files)} />
            </div>

            <div style={{ fontSize: 12, marginTop: 8 }}>
              {(uploadsByArea[a.key]?.length || 0)} / {a.minPhotos} uploaded
            </div>

            <ul style={{ fontSize: 12, color: '#333' }}>
              {(uploadsByArea[a.key] || []).map((f, i) => <li key={i}>{f.name}</li>)}
            </ul>
          </div>
        ))}
      </div>

      <div style={{ display: 'flex', gap: 12, marginTop: 24 }}>
        <button onClick={runPrecheck}>Run AI Pre-Check</button>
        <button onClick={submitAll} disabled={submitting}>{submitting ? 'Submitting…' : 'Submit Turn'}</button>
      </div>

      <div style={{ marginTop: 16 }}>
        <b>AI Findings:</b>
        <ul>{aiFlags.map((f, i) => <li key={i}>{f}</li>)}</ul>
      </div>
    </div>
  );
}
