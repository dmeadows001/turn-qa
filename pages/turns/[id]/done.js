// pages/turns/[id]/done.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

async function fetchTurn(turnId) {
  const r = await fetch(`/api/get-turn?id=${turnId}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'get-turn failed');
  return j.turn;
}

async function fetchPhotos(turnId) {
  const r = await fetch(`/api/list-turn-photos?id=${turnId}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'list-turn-photos failed');
  return j.photos || [];
}

export default function Done() {
  const router = useRouter();
  const turnId = router.query.id;

  const [turn, setTurn] = useState(null);
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!turnId) return;
    (async () => {
      try {
        setLoading(true);
        const [t, p] = await Promise.all([fetchTurn(turnId), fetchPhotos(turnId)]);
        setTurn(t || null);
        setPhotos(p || []);
      } finally {
        setLoading(false);
      }
    })();
  }, [turnId]);

  const box = { maxWidth: 640, margin: '36px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const card = { background: '#fff', border: '1px solid #e5e7eb', borderRadius: 16, padding: 16 };
  const muted = { color: '#475569' };

  return (
    <div style={box}>
      <div style={{ textAlign: 'center', marginBottom: 12 }}>
        <div style={{ fontSize: 56, lineHeight: 1 }}>🎉</div>
        <h1 style={{ margin: '8px 0 0' }}>Turn submitted!</h1>
        <div style={{ ...muted, marginTop: 8 }}>Thank you — you’re all set.</div>
      </div>

      <div style={card}>
        {loading ? (
          <div>Loading summary…</div>
        ) : (
          <>
            <div style={{ fontWeight: 700, marginBottom: 8 }}>Summary</div>
            <div style={{ display: 'grid', rowGap: 6, fontSize: 14 }}>
              <div><b>Photos uploaded:</b> {photos.length}</div>
              <div><b>Status:</b> {(turn?.status || 'submitted').replace('_', ' ')}</div>
              {turn?.turn_date && <div><b>Date:</b> {turn.turn_date}</div>}
            </div>

            <div style={{ display: 'flex', gap: 8, marginTop: 16, flexWrap: 'wrap' }}>
              <a
                href="/cleaners"
                style={{
                  textDecoration: 'none', padding: '12px 14px', borderRadius: 12,
                  background: '#0ea5e9', color: '#fff', fontWeight: 700
                }}
              >
                Start another turn
              </a>

              <a
                href="/"
                style={{
                  textDecoration: 'none', padding: '12px 14px', borderRadius: 12,
                  background: '#f8fafc', border: '1px solid #e5e7eb', color: '#0f172a', fontWeight: 700
                }}
              >
                Back to home
              </a>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
