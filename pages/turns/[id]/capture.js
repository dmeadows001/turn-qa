// pages/turns/[id]/capture.js
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

/**
 * IMPORTANT SECURITY NOTE
 * -------------------------------------------------
 * This file NEVER:
 *  - reads Supabase directly
 *  - signs storage URLs client-side
 *  - trusts query params for ownership
 *
 * ALL sensitive data comes from API routes that
 * enforce RLS + manager/cleaner ownership.
 */

// Fallback default shots if no template is linked
const DEFAULT_SHOTS = [
  { shot_id: 'fallback-entry', area_key: 'entry', label: 'Entry - Overall', min_count: 1 },
  { shot_id: 'fallback-living', area_key: 'living', label: 'Living Room', min_count: 1 },
  { shot_id: 'fallback-kitchen', area_key: 'kitchen', label: 'Kitchen', min_count: 2 },
  { shot_id: 'fallback-bath', area_key: 'bathroom', label: 'Bathroom', min_count: 1 },
  { shot_id: 'fallback-bed', area_key: 'bedroom', label: 'Bedroom', min_count: 1 },
];

// ---------- helpers ----------
async function signPath(path) {
  const r = await fetch('/api/sign-photo', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ path, expires: 600 }),
  });
  if (!r.ok) throw new Error('sign failed');
  const j = await r.json();
  return j.url;
}

async function openSignedPath(path) {
  const win = window.open('', '_blank');
  const url = await signPath(path);
  if (!url) return;
  if (win) win.location = url;
  else window.location.href = url;
}

// ---------- component ----------
export default function Capture() {
  const router = useRouter();
  const turnId = typeof router.query.id === 'string' ? router.query.id : '';

  const [loading, setLoading] = useState(true);
  const [shots, setShots] = useState([]);
  const [uploadsByShot, setUploadsByShot] = useState({});
  const [templateInfo, setTemplateInfo] = useState({ property: '', template: '' });
  const [msg, setMsg] = useState('');
  const [submitting, setSubmitting] = useState(false);

  // signed thumbnail cache
  const [thumbByPath, setThumbByPath] = useState({});
  const requestedThumbs = useRef(new Set());

  function ensureThumb(path) {
    if (!path || requestedThumbs.current.has(path) || thumbByPath[path]) return;
    requestedThumbs.current.add(path);
    signPath(path)
      .then((url) => {
        if (url) {
          setThumbByPath((p) => ({ ...p, [path]: url }));
        }
      })
      .catch(() => {
        requestedThumbs.current.delete(path);
      });
  }

  // ---------- LOAD TEMPLATE (secure) ----------
  useEffect(() => {
    if (!turnId) return;

    (async () => {
      try {
        setLoading(true);

        // ✅ Ownership enforced in API
        const r = await fetch(`/api/turn-template?turnId=${turnId}`);
        if (!r.ok) {
          throw new Error('Unauthorized or missing turn');
        }

        const j = await r.json();

        const nextShots =
          Array.isArray(j.shots) && j.shots.length
            ? j.shots.map((s) => ({
                shot_id: s.shot_id,
                area_key: s.area_key,
                label: s.label,
                min_count: s.min_count || 1,
                reference_paths: Array.isArray(s.reference_paths) ? s.reference_paths : [],
              }))
            : DEFAULT_SHOTS;

        setShots(nextShots);
        setTemplateInfo(j.rules || { property: '', template: '' });
      } catch (e) {
        console.error('[capture loadTemplate]', e);
        setMsg('Could not load this turn.');
        setShots(DEFAULT_SHOTS);
      } finally {
        setLoading(false);
      }
    })();
  }, [turnId]);

  // ---------- LOAD EXISTING PHOTOS (secure) ----------
  useEffect(() => {
    if (!turnId || !shots.length) return;

    (async () => {
      try {
        // ✅ API enforces turn ownership
        const r = await fetch(`/api/list-turn-photos?id=${turnId}`);
        if (!r.ok) return;

        const j = await r.json();
        const items = Array.isArray(j.photos) ? j.photos : [];

        const byShot = {};
        for (const it of items) {
          const sid = it.shot_id || '__extras__';
          (byShot[sid] ||= []).push({
            url: it.path,
            name: it.path.split('/').pop(),
            isFix: !!it.is_fix,
            managerNote: it.manager_note || null,
            capturedAt: it.captured_at || null,
          });
        }

        setUploadsByShot(byShot);
        items.forEach((i) => ensureThumb(i.path));
      } catch (e) {
        console.error('[capture loadExisting]', e);
      }
    })();
  }, [turnId, shots]);

  // ---------- SUBMIT ----------
  async function submitAll() {
    if (submitting) return;

    const unmet = shots.filter(
      (s) => (s.min_count || 1) > (uploadsByShot[s.shot_id]?.length || 0)
    );
    if (unmet.length) {
      alert(
        'Missing required photos:\n' +
          unmet.map((u) => `• ${u.label}`).join('\n')
      );
      return;
    }

    setSubmitting(true);
    try {
      const photos = Object.values(uploadsByShot)
        .flat()
        .map((f) => ({
          url: f.url,
          shotId: f.shot_id,
        }));

      const r = await fetch('/api/submit-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turnId, photos }),
      });

      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || 'Submit failed');
      }

      router.replace(`/turns/${turnId}/done`);
    } catch (e) {
      alert(e.message);
    } finally {
      setSubmitting(false);
    }
  }

  // ---------- RENDER ----------
  if (loading) {
    return (
      <ChromeDark title="Capture">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  return (
    <ChromeDark title="Capture">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ marginTop: 0 }}>{templateInfo.property}</h2>

          {msg && <div style={{ color: '#fca5a5' }}>{msg}</div>}

          {shots.map((s) => {
            const files = uploadsByShot[s.shot_id] || [];
            const missing = Math.max(0, (s.min_count || 1) - files.length);

            return (
              <div
                key={s.shot_id}
                style={{
                  border: ui.card.border,
                  borderRadius: 10,
                  padding: 12,
                  margin: '12px 0',
                }}
              >
                <div style={{ fontWeight: 700 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: missing ? '#f59e0b' : '#22c55e' }}>
                  Required: {s.min_count} • Uploaded: {files.length}
                </div>

                <div
                  style={{
                    marginTop: 10,
                    display: 'grid',
                    gridTemplateColumns: 'repeat(auto-fill,minmax(200px,1fr))',
                    gap: 12,
                  }}
                >
                  {files.map((f) => {
                    if (!thumbByPath[f.url]) ensureThumb(f.url);
                    return (
                      <div
                        key={f.url}
                        style={{
                          border: '1px solid #334155',
                          borderRadius: 8,
                          padding: 8,
                          background: '#020617',
                        }}
                      >
                        {thumbByPath[f.url] ? (
                          <img
                            src={thumbByPath[f.url]}
                            alt={f.name}
                            style={{
                              width: '100%',
                              height: 140,
                              objectFit: 'cover',
                              borderRadius: 6,
                            }}
                          />
                        ) : (
                          <div style={{ height: 140, background: '#0f172a' }} />
                        )}

                        <button
                          onClick={() => openSignedPath(f.url)}
                          style={{ ...ui.btnSecondary, marginTop: 6 }}
                        >
                          👁 View
                        </button>

                        {f.managerNote && (
                          <div
                            style={{
                              marginTop: 6,
                              fontSize: 12,
                              color: '#fde68a',
                              background: '#3a2b10',
                              borderRadius: 6,
                              padding: 6,
                            }}
                          >
                            {f.managerNote}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}

          <button
            onClick={submitAll}
            disabled={submitting}
            style={{ ...ui.btnPrimary, width: '100%', marginTop: 16 }}
          >
            {submitting ? 'Submitting…' : '✅ Submit Turn'}
          </button>
        </div>
      </section>
    </ChromeDark>
  );
}
