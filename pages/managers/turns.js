// pages/managers/turns.js
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

// ---- Error boundary so a render-time bug won't 500 the page ----
import React from 'react';
class ErrorBoundary extends React.Component {
  constructor(props){ super(props); this.state = { hasError:false, err:null }; }
  static getDerivedStateFromError(err){ return { hasError:true, err }; }
  componentDidCatch(err, info){ console.error('ManagerTurns render error:', err, info); }
  render(){
    if (this.state.hasError) {
      return (
        <ChromeDark title="Manager — Turns">
          <section style={ui.sectionGrid}>
            <div style={ui.card}>
              <div style={{ color:'#fca5a5', fontWeight:700 }}>Something went wrong rendering this page.</div>
              <div style={{ color:'#94a3b8', marginTop:8, whiteSpace:'pre-wrap' }}>
                {String(this.state.err?.message || this.state.err || 'Unknown error')}
              </div>
            </div>
          </section>
        </ChromeDark>
      );
    }
    return this.props.children;
  }
}

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

function ManagerTurnsInner() {
  const [status, setStatus]   = useState('submitted');
  const [from, setFrom]       = useState(() => {
    const d = new Date(); d.setMonth(d.getMonth()-1);
    return new Date(d).toISOString().slice(0,10);
  });
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
      // If this API throws a 500, surface the JSON error text in the UI:
      let j = {};
      try { j = await r.json(); } catch {}
      if (!r.ok) throw new Error(j.error || `list-turns failed (${r.status})`);

      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch(e) {
      console.error('load /api/list-turns failed', e);
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); /* eslint-disable-next-line */ }, []);

  const filtered = useMemo(() => rows, [rows]);

  return (
    <ChromeDark title="Manager — Turns">
      <section style={ui.sectionGrid}>
        {/* Filters */}
        <div style={ui.card}>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(200px,1fr))', gap:12 }}>
            <div>
              <div style={ui.label}>Status</div>
              <select
                value={status}
                onChange={e=>setStatus(e.target.value)}
                style={{ ...ui.input, background: '#0b1220', cursor:'pointer' }}
              >
                {statuses.map(s => <option key={s.v} value={s.v}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <div style={ui.label}>From</div>
              <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={ui.input}/>
            </div>
            <div>
              <div style={ui.label}>To</div>
              <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={ui.input}/>
            </div>
            <div style={{ alignSelf:'end' }}>
              <button onClick={load} style={{ ...ui.btnPrimary, width:'100%' }}>
                {loading ? 'Loading…' : 'Apply filters'}
              </button>
            </div>
          </div>
          {err && <div style={{ color:'#fca5a5', marginTop:12 }}>{err}</div>}
        </div>

        {/* Results */}
        <div style={ui.card}>
          {loading ? (
            <div>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={ui.muted}>No turns match these filters.</div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth: 700 }}>
                <thead>
                  <tr style={{ textAlign:'left', borderBottom:'1px solid #1f2937' }}>
                    <th style={{ padding:'10px 8px' }}>Created</th>
                    <th style={{ padding:'10px 8px' }}>Property</th>
                    <th style={{ padding:'10px 8px' }}>Status</th>
                    <th style={{ padding:'10px 8px' }}>Submitted</th>
                    <th style={{ padding:'10px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map(t => (
                    <tr key={t.id} style={{ borderBottom:'1px solid #111827' }}>
                      <td style={{ padding:'10px 8px', color:'#cbd5e1' }}>{niceDate(t.created_at)}</td>
                      <td style={{ padding:'10px 8px' }}>{t.property_name}</td>
                      <td style={{ padding:'10px 8px', textTransform:'capitalize' }}>{t.status || '—'}</td>
                      <td style={{ padding:'10px 8px' }}>{t.submitted_at ? niceDate(t.submitted_at) : '—'}</td>
                      <td style={{ padding:'10px 8px' }}>
                        <Link
                          href={`/turns/${t.id}/review?manager=1`}
                          style={{ ...ui.btnSecondary, display:'inline-block' }}
                        >
                          Open
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ ...ui.subtle }}>
          <Link href="/managers" style={{ color:'#9ca3af' }}>← Back to Managers home</Link>
        </div>
      </section>
    </ChromeDark>
  );
}

export default function ManagerTurns() {
  return (
    <ErrorBoundary>
      <ManagerTurnsInner />
    </ErrorBoundary>
  );
}
