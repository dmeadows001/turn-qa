// pages/managers/turns.js
import { useEffect, useMemo, useState } from 'react';

async function loadTurns({ status, from, to }) {
  const params = new URLSearchParams();
  if (status) params.set('status', status);
  if (from)   params.set('from', from);
  if (to)     params.set('to', to);
  const r = await fetch(`/api/managers/list-turns?${params.toString()}`);
  const j = await r.json();
  if (!r.ok) throw new Error(j.error || 'load failed');
  return j.turns || [];
}

function fmtDate(d) {
  try { return new Date(d).toLocaleDateString(); } catch { return d || '—'; }
}
function fmtTime(d) {
  try { return new Date(d).toLocaleString(); } catch { return d || '—'; }
}

export default function ManagerTurns() {
  // default to last 14 days
  const today = useMemo(() => new Date(), []);
  const twoWeeksAgo = useMemo(() => {
    const d = new Date();
    d.setDate(d.getDate() - 14);
    return d;
  }, []);

  const [status, setStatus] = useState('submitted'); // default filter
  const [from, setFrom] = useState(twoWeeksAgo.toISOString().slice(0, 10));
  const [to, setTo] = useState(today.toISOString().slice(0, 10));

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState('');

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setErr('');
      try {
        const data = await loadTurns({ status, from, to });
        if (!cancelled) setRows(data);
      } catch (e) {
        if (!cancelled) setErr(e.message || 'load failed');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [status, from, to]);

  const card = { background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:12 };
  const label = { fontWeight:700, marginBottom:6 };
  const input = {
    width:'100%', maxWidth: '100%', boxSizing:'border-box',
    padding:10, border:'1px solid #cbd5e1', borderRadius:10, fontSize:16
  };

  return (
    <div style={{ maxWidth: 1100, margin: '28px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' }}>
      <h1 style={{ marginBottom: 8 }}>Manager — Turns</h1>
      <p style={{ color:'#475569', marginBottom: 12 }}>
        Filter by status and date range (uses the service date: <code>turn_date</code>).
      </p>

      {/* Filters */}
      <div style={{ ...card, marginBottom: 14 }}>
        <div style={{ display: 'grid', gap: 10, gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))' }}>
          <div>
            <div style={label}>Status</div>
            <select value={status} onChange={e=>setStatus(e.target.value)} style={input}>
              <option value="">(any)</option>
              <option value="in_progress">in_progress</option>
              <option value="submitted">submitted</option>
              <option value="needs_fix">needs_fix</option>
              <option value="approved">approved</option>
            </select>
          </div>

          <div>
            <div style={label}>From (service date)</div>
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={input}/>
          </div>

          <div>
            <div style={label}>To (service date)</div>
            <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={input}/>
          </div>
        </div>
      </div>

      {/* Results */}
      <div style={card}>
        {err && <div style={{ color:'#b91c1c', marginBottom:8 }}>Error: {err}</div>}

        {loading ? (
          <div>Loading…</div>
        ) : rows.length === 0 ? (
          <div style={{ color:'#64748b' }}>No turns match these filters.</div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width:'100%', borderCollapse:'collapse', fontSize:14 }}>
              <thead>
                <tr style={{ textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>
                  <th style={{ padding:'10px 6px' }}>Date</th>
                  <th style={{ padding:'10px 6px' }}>Status</th>
                  <th style={{ padding:'10px 6px' }}>Property</th>
                  <th style={{ padding:'10px 6px' }}>Cleaner</th>
                  <th style={{ padding:'10px 6px' }}>Submitted</th>
                  <th style={{ padding:'10px 6px' }}>Approved</th>
                  <th style={{ padding:'10px 6px' }}>Actions</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(r => (
                  <tr key={r.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'8px 6px' }}>{fmtDate(r.turn_date)}</td>
                    <td style={{ padding:'8px 6px', textTransform:'capitalize' }}>{(r.status || '').replace('_',' ')}</td>
                    <td style={{ padding:'8px 6px' }}>{r.property_id || '—'}</td>
                    <td style={{ padding:'8px 6px' }}>{r.cleaner_name || '—'}</td>
                    <td style={{ padding:'8px 6px' }}>{r.submitted_at ? fmtTime(r.submitted_at) : '—'}</td>
                    <td style={{ padding:'8px 6px' }}>{r.approved_at ? fmtTime(r.approved_at) : '—'}</td>
                    <td style={{ padding:'8px 6px' }}>
                      <a
                        href={`/turns/${r.id}/review?manager=1`}
                        style={{ color:'#0369a1', textDecoration:'none', fontWeight:700 }}
                        target="_blank" rel="noreferrer"
                      >
                        Open Review →
                      </a>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
