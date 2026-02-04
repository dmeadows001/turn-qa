// pages/turns/[id]/checklist.js
import { useRouter } from 'next/router';
import { useEffect, useRef, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

const supabase = supabaseBrowser();

export default function TurnChecklist() {
  const router = useRouter();
  const turnId = typeof router.query.id === 'string' ? router.query.id : '';

  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');
  const [data, setData] = useState(null);

  // Signed thumbnail cache (for reference photos)
  const [thumbByPath, setThumbByPath] = useState({});
  const requestedThumbsRef = useRef(new Set());

  // Lightbox for reference photos
  const [lightbox, setLightbox] = useState({ open: false, urls: [], index: 0 });

  async function getAccessToken() {
    try {
      const { data } = await supabase.auth.getSession();
      return data?.session?.access_token || null;
    } catch {
      return null;
    }
  }

  async function authHeaders() {
    const token = await getAccessToken();
    return token ? { Authorization: `Bearer ${token}` } : {};
  }

  async function signPath(path) {
    const headers = await authHeaders();
    const resp = await fetch('/api/sign-photo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...headers,
      },
      body: JSON.stringify({ path, expires: 600 }),
    });
    if (!resp.ok) throw new Error('sign failed');
    const json = await resp.json().catch(() => ({}));
    return json.url;
  }

  function ensureThumb(path) {
    if (!path || requestedThumbsRef.current.has(path) || thumbByPath[path]) return;
    requestedThumbsRef.current.add(path);
    signPath(path)
      .then((url) => {
        if (!url) return;
        setThumbByPath((prev) => (prev[path] ? prev : { ...prev, [path]: url }));
      })
      .catch(() => {
        requestedThumbsRef.current.delete(path);
      });
  }

  async function openLightbox(paths, startIndex = 0) {
    const list = Array.isArray(paths) ? paths.filter(Boolean) : [];
    if (!list.length) return;

    try {
      const urls = [];
      for (const p of list) {
        try {
          const u = await signPath(p);
          if (u) urls.push(u);
        } catch {}
      }
      if (!urls.length) return;

      setLightbox({
        open: true,
        urls,
        index: Math.min(startIndex, urls.length - 1),
      });
    } catch (e) {
      console.error('openLightbox error:', e);
    }
  }

  function closeLightbox() {
    setLightbox((prev) => ({ ...prev, open: false }));
  }
  function nextLightbox(e) {
    if (e) e.stopPropagation();
    setLightbox((prev) => {
      if (!prev.urls.length) return prev;
      const nextIndex = (prev.index + 1) % prev.urls.length;
      return { ...prev, index: nextIndex };
    });
  }
  function prevLightbox(e) {
    if (e) e.stopPropagation();
    setLightbox((prev) => {
      if (!prev.urls.length) return prev;
      const nextIndex = (prev.index - 1 + prev.urls.length) % prev.urls.length;
      return { ...prev, index: nextIndex };
    });
  }

  useEffect(() => {
    if (!lightbox.open) return;
    function onKey(e) {
      if (e.key === 'Escape') closeLightbox();
      if (e.key === 'ArrowRight') nextLightbox();
      if (e.key === 'ArrowLeft') prevLightbox();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [lightbox.open]);

  useEffect(() => {
    if (!turnId) return;

    (async () => {
      setLoading(true);
      setErr('');

      try {
        // ✅ Attach Bearer token if manager is logged in
        const headers = await authHeaders();

        const r = await fetch(`/api/turn-template?turnId=${encodeURIComponent(turnId)}`, {
          headers,
        });

        const j = await r.json().catch(() => ({}));
        if (!r.ok || !j?.ok) {
          throw new Error(j?.error || 'Failed to load turn template');
        }

        setData(j);

        // warm thumbnails
        const shots = Array.isArray(j.shots) ? j.shots : [];
        shots.forEach((s) => {
          (Array.isArray(s.reference_paths) ? s.reference_paths : []).forEach((p) => ensureThumb(p));
        });
      } catch (e) {
        setErr(e?.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [turnId]);

  const shots = Array.isArray(data?.shots) ? data.shots : [];
  const propertyName = data?.property_name || data?.rules?.property || '';
  const propertyId = data?.property_id || '';

  return (
    <ChromeDark title="Turn Checklist">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', flexWrap: 'wrap' }}>
            <div>
              <h2 style={{ margin: 0 }}>Turn Checklist</h2>
              <div style={{ ...ui.subtle, marginTop: 6 }}>
                {propertyName ? <>Property: <b>{propertyName}</b></> : 'Property: —'}
                {turnId ? <span> • Turn: <span style={{ opacity: 0.8 }}>{turnId}</span></span> : null}
              </div>
            </div>

            <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
              <button
                type="button"
                onClick={() => {
                  // go back to checklist builder (template builder) for this property
                  if (propertyId) router.push(`/properties/${propertyId}/template`);
                  else router.push('/managers/turns');
                }}
                style={ui.btnSecondary}
              >
                ← Back to checklist builder
              </button>

            </div>
          </div>

          {loading ? (
            <div style={{ marginTop: 14, ...ui.subtle }}>Loading…</div>
          ) : err ? (
            <div style={{ marginTop: 14, color: '#fca5a5' }}>{err}</div>
          ) : (
            <>
              <div style={{ marginTop: 14, ...ui.subtle }}>
                Template: <b>{data?.rules?.template || '—'}</b> • Sections: <b>{shots.length}</b>
              </div>

              {shots.length === 0 ? (
                <div style={{ marginTop: 16, ...ui.subtle }}>No checklist sections found for this turn.</div>
              ) : (
                <div style={{ marginTop: 16, display: 'grid', gap: 14 }}>
                  {shots.map((s) => {
                    const refs = Array.isArray(s.reference_paths) ? s.reference_paths : [];
                    return (
                      <div
                        key={s.shot_id}
                       style={{
                        border: '1px solid #1f2937',
                        borderRadius: 14,
                        background: 'rgba(15, 23, 42, 0.55)',  // capture-like
                        padding: 14,
                      }}

                      >
                        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'flex-start', flexWrap: 'wrap' }}>
                          <div>
                            <div style={{ fontSize: 16, fontWeight: 800, color: '#e5e7eb' }}>
                              {s.label || 'Untitled'}
                            </div>
                            <div style={{ fontSize: 12, color: '#94a3b8', marginTop: 4 }}>
                              Area: <b>{s.area_key || '—'}</b> • Required: <b>{s.min_count || 1}</b>
                            </div>
                          </div>

                          {refs.length ? (
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>
                              Reference photo{refs.length > 1 ? 's' : ''}: <b>{refs.length}</b>
                            </div>
                          ) : (
                            <div style={{ fontSize: 12, color: '#94a3b8' }}>No reference photos</div>
                          )}
                        </div>

{refs.length > 0 && (
  <div
    style={{
      marginTop: 10,
      background: '#020617',           // darker “cell” behind thumbs (like cleaner)
      border: '1px solid #1f2937',
      borderRadius: 12,
      padding: 12,
    }}
  >
    <div style={{ fontSize: 12, color: '#9ca3af', fontWeight: 700, marginBottom: 8 }}>
      Reference photo — how this area should look
    </div>

    <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
      {refs.map((path, idx) => {
        if (!thumbByPath[path]) ensureThumb(path);
        const thumb = thumbByPath[path] || null;

        return (
          <button
            key={path}
            type="button"
            onClick={() => openLightbox(refs, idx)}
            style={{ padding: 0, border: 'none', background: 'transparent', cursor: 'pointer' }}
            title="Open reference"
          >
            {thumb ? (
              <img
                src={thumb}
                alt="Reference"
                style={{
                  width: 92,
                  height: 92,
                  objectFit: 'cover',
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#0b1220',
                }}
              />
            ) : (
              <div
                style={{
                  width: 92,
                  height: 92,
                  borderRadius: 10,
                  border: '1px solid #334155',
                  background: '#0f172a',
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  </div>
)}


        {/* Lightbox overlay */}
        {lightbox.open && lightbox.urls.length > 0 && (
          <div
            onClick={closeLightbox}
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
                onClick={closeLightbox}
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
                src={lightbox.urls[lightbox.index]}
                alt="Reference"
                style={{
                  maxWidth: '100%',
                  maxHeight: '70vh',
                  borderRadius: 12,
                  boxShadow: '0 10px 40px rgba(0,0,0,0.6)',
                  objectFit: 'contain',
                }}
              />

              {lightbox.urls.length > 1 && (
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 4, color: '#e5e7eb', fontSize: 13 }}>
                  <button
                    type="button"
                    onClick={prevLightbox}
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
                    {lightbox.index + 1} / {lightbox.urls.length}
                  </span>
                  <button
                    type="button"
                    onClick={nextLightbox}
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
      </section>
    </ChromeDark>
  );
}
