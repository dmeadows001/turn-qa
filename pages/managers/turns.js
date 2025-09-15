// pages/managers/turns.js
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

function niceDate(s) {
  try { return new Date(s).toLocaleString(); } catch { return s || '—'; }
}

const statuses = [
  { v: '',            label: 'Any' },
  { v: 'submitted',   label: 'Submitted' },
  { v: 'needs_fix',   label: 'Needs Fix' },
  { v: 'approved',    label: 'Approved' },
  { v: 'in_progress', label: 'In Progress' },
  { v: 'cancelled',   label: 'Cancelled' },
];

export default function ManagerTurns() {
  const [status, setStatus]   = useState('submitted');
  const [from, setFrom]       = useState(() => new Date(new Date().setMonth(new Date().getMonth()-1)).toISOString().slice(0,10));
  const [to, setTo]           = useState(() => new Date().toISOString().slice(0,10));
  const [rows, setRows]       = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr]         = useState('');

  async function load() {
    setLoading(true); setErr('');
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (from)   qs.set('from', `${from}T00:00:00Z`);
      if (to)     qs.set('to',   `${to}T23:59:59Z`);
      const r = await fetch(`/api/list-turns?${qs.toString()}`);
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'load failed');
      setRows(j.rows || []);
    } catch(e) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => rows, [rows]);

  const wrap = {
    maxWidth: 1100, margin: '24px auto', padding: '0 16px', fontFamily: 'ui-sans-serif'
  };
  const card = {
    border:'1px solid #e5e7eb', borderRadius:12, padding:12, background:'#fff'
  };

  return (
    <div style={wrap}>
      <h1>Manager — Turns</h1>

      {/* Filters */}
      <div style={{ ...card, display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(180px,1fr))', gap:12 }}>
        <div>
          <div style={{ fontSize:12, color:'#475569', marginBottom:4 }}>Status</div>
          <select value={status} onChange={e=>setStatus(e.target.value)} style={{ width:'100%', padding:8, borderRadius:8, border:'1px solid #cbd5e1' }}>
            {statuses.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
          </select>
        </div>
        <div>
          <div style={{ fontSize:12, color:'#475569', marginBottom:4 }}>From</div>
          <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{ width:'100%', padding:8, borderRadius:8, border:'1px solid #cbd5e1' }}/>
        </div>
        <div>
          <div style={{ fontSize:12, color:'#475569', marginBottom:4 }}>To</div>
          <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{ width:'100%', padding:8, borderRadius:8, border:'1px solid #cbd5e1' }}/>
        </div>
        <div style={{ alignSelf:'end' }}>
          <button onClick={load} style={{ padding:'10px 14px', borderRadius:10, border:'1px solid #0ea5e9', background:'#e0f2fe', cursor:'pointer', width:'100%' }}>
            {loading ? 'Loading…' : 'Apply Filters'}
          </button>
        </div>
      </div>

      {err && <div style={{ color:'#b91c1c', marginTop:12 }}>{err}</div>}

      {/* Results */}
      <div style={{ ...card, marginTop:16 }}>
        {loading ? <div>Loading…</div> :
          filtered.length === 0 ? <div>No turns match these filters.</div> :
          (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>
                  <th style={{ padding:'8px 6px' }}>Created</th>
                  <th style={{ padding:'8px 6px' }}>Property</th>
                  <th style={{ padding:'8px 6px' }}>Status</th>
                  <th style={{ padding:'8px 6px' }}>Submitted</th>
                  <th style={{ padding:'8px 6px' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtered.map(t => (
                  <tr key={t.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'8px 6px' }}>{niceDate(t.created_at)}</td>
                    <td style={{ padding:'8px 6px' }}>{t.property_name}</td>
                    <td style={{ padding:'8px 6px', textTransform:'capitalize' }}>{t.status || '—'}</td>
                    <td style={{ padding:'8px 6px' }}>{t.submitted_at ? niceDate(t.submitted_at) : '—'}</td>
                    <td style={{ padding:'8px 6px' }}>
                      <Link
                        href={`/turns/${t.id}/review`}
                        style={{
                          padding:'6px 10px',
                          border:'1px solid #94a3b8',
                          borderRadius:8,
                          textDecoration:'none',
                          display:'inline-block'
                        }}
                      >
                        Open
                      </Link>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        }
      </div>

      <div style={{ marginTop:12 }}>
        <Link href="/managers">← Back to Managers home</Link>
      </div>
    </div>
  );
}
