import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';

export default function Review() {
  const { query } = useRouter();
  const turnId = query.id;
  const [photos, setPhotos] = useState([]);
  const [loading, setLoading] = useState(true);

  async function load() {
    if (!turnId) return;
    setLoading(true);
    const resp = await fetch(`/api/turn-photos?turnId=${turnId}`);
    const json = await resp.json();
    setPhotos(json.photos || []);
    setLoading(false);
  }

  useEffect(() => { load(); }, [turnId]);

  if (!turnId) return <div style={{ padding:24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1200, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {turnId} — Review</h1>
      <p>Click a photo to open in a new tab. Use notes to flag issues; PASS when satisfied.</p>

      {loading ? <div>Loading photos…</div> : (
        photos.length === 0 ? <div>No photos yet.</div> : (
          <div style={{
            display:'grid',
            gridTemplateColumns:'repeat(auto-fill, minmax(220px,1fr))',
            gap: 12, marginTop: 16
          }}>
            {photos.map(p => (
              <div key={p.id} style={{ border:'1px solid #eee', borderRadius:12, overflow:'hidden' }}>
                <a href={p.signedUrl} target="_blank" rel="noreferrer">
                  <img src={p.signedUrl} style={{ width:'100%', display:'block', aspectRatio:'4/3', objectFit:'cover' }} />
                </a>
                <div style={{ padding:10, fontSize:12 }}>
                  <div><b>{p.area_key}</b></div>
                  <div>{p.width}×{p.height}</div>
                  <div style={{ color:'#666' }}>{new Date(p.created_at).toLocaleString()}</div>
                </div>
              </div>
            ))}
          </div>
        )
      )}
    </div>
  );
}
