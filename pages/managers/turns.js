// pages/managers/turns.js
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';

function Badge({ status }) {
  const map = {
    in_progress: { bg: '#e2e8f0', fg: '#0f172a', label: 'In Progress' },
    submitted:   { bg: '#dbeafe', fg: '#1e3a8a', label: 'Submitted' },
    needs_fix:   { bg: '#fef3c7', fg: '#7c2d12', label: 'Needs Fix' },
    approved:    { bg: '#dcfce7', fg: '#065f46', label: 'Approved' },
    cancelled:   { bg: '#fee2e2', fg: '#7f1d1d', label: 'Cancelled' }
  };
  const s = map[status] || map.in_progress;
  return (
    <span style={{
      display:'inline-block', padding:'4px 8px', borderRadius:999,
      background:s.bg, color:s.fg, fontSize:12, fontWeight:700
    }}>
      {s.label}
    </span>
  );
}

export default function ManagerTurns() {
  // filters
  const [status, setStatus] = useState('submitted');
  const [propertyId, setPropertyId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  // data
  const [loading, setLoading] = useState(true);
  const [turns, setTurns] = useState([]);
  const [properties, setProperties] = useState([]);
  const [actingId, setActingId] = useState(null); // row-level spinner

  // load properties for dropdown
  useEffect(() => {
    (async () => {
      try {
        const r = await fetch('/api/list-properties');
        const j = await r.json();
        setProperties(j.properties || []);
      } catch (e) {
        console.error(e);
      }
    })();
  }, []);

  const query = useMemo(() => ({
    status: status || undefined,
    property_id: propertyId || undefined,
    date_from: from || undefined,
    date_to: to || undefined,
    limit: 50,
  }), [status, propertyId, from, to]);

  async function refresh() {
    setLoading(true);
    try {
      const r = await fetch('/api/list-turns', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(query)
      });
      const j = await r.json();
      setTurns(j.turns || []);
    } catch (e) {
      console.error(e);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { refresh(); }, [query]); // load on filter change

  async function act(turnId, newStatus) {
    const note = newStatus === 'needs_fix'
      ? (window.prompt('Optional note for cleaner (visible in review):', '') || '')
      : '';

    setActingId(turnId);
    // optimistic local patch
    const prev = turns.slice();
    setTurns(ts => ts.map(t => t.id === turnId ? { ...t, status: newStatus } : t));

    try {
      const r = await fetch('/api/update-turn-status', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ turn_id: turnId, new_status: newStatus, manager_note: note })
      });
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'update failed');

      // On approve: keep it in the list only if the filter matches
      // Easiest: just refresh if status filter is not empty
      if (status) await refresh();
    } catch (e) {
      console.error(e);
      alert(e.message || 'Could not update status.');
      // revert optimistic change
      setTurns(prev);
    } finally {
      setActingId(null);
    }
  }

  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc' }}>
      <header style={{ padding:'22px 16px', borderBottom:'1px solid #e5e7eb', background:'#ffffff' }}>
        <div style={{ maxWidth:1100, margin:'0 auto' }}>
          <h1 style={{ margin:0, fontSize:28, color:'#0f172a' }}>Review Turns</h1>
          <div style={{ color:'#64748b', marginTop:6 }}>
            Filter by status, property, or date. Click a property to open the review screen.
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1100, margin:'0 auto', padding:'18px 16px' }}>
        {/* Filters */}
        <div style={{
          background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, padding:12, marginBottom:16,
          display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(220px,1fr))', gap:12
        }}>
          <label>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569', marginBottom:6 }}>Status</div>
            <select value={status} onChange={e=>setStatus(e.target.value)} style={{ width:'100%', padding:'10px', borderRadius:10, border:'1px solid #cbd5e1' }}>
              <option value="">(Any)</option>
              <option value="in_progress">In Progress</option>
              <option value="submitted">Submitted</option>
              <option value="needs_fix">Needs Fix</option>
              <option value="approved">Approved</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </label>

          <label>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569', marginBottom:6 }}>Property</div>
            <select value={propertyId} onChange={e=>setPropertyId(e.target.value)} style={{ width:'100%', padding:'10px', borderRadius:10, border:'1px solid #cbd5e1' }}>
              <option value="">(All)</option>
              {properties.map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
          </label>

          <label>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569', marginBottom:6 }}>From (date)</div>
            <input type="date" value={from} onChange={e=>setFrom(e.target.value)} style={{ width:'100%', padding:'10px', borderRadius:10, border:'1px solid #cbd5e1' }}/>
          </label>

          <label>
            <div style={{ fontSize:12, fontWeight:700, color:'#475569', marginBottom:6 }}>To (date)</div>
            <input type="date" value={to} onChange={e=>setTo(e.target.value)} style={{ width:'100%', padding:'10px', borderRadius:10, border:'1px solid #cbd5e1' }}/>
          </label>
        </div>

        {/* Table */}
        <div style={{ background:'#fff', border:'1px solid #e5e7eb', borderRadius:12, overflow:'hidden' }}>
          <table style={{ width:'100%', borderCollapse:'collapse' }}>
            <thead>
              <tr style={{ background:'#f1f5f9', borderBottom:'1px solid #e5e7eb' }}>
                <th style={{ textAlign:'left', padding:'10px 8px', fontSize:12, color:'#475569' }}>Status</th>
                <th style={{ textAlign:'left', padding:'10px 8px', fontSize:12, color:'#475569' }}>Property / Cleaner</th>
                <th style={{ textAlign:'left', padding:'10px 8px', fontSize:12, color:'#475569' }}>Date</th>
                <th style={{ textAlign:'left', padding:'10px 8px', fontSize:12, color:'#475569' }}>Photos</th>
                <th style={{ textAlign:'left', padding:'10px 8px', fontSize:12, color:'#475569' }}>Findings</th>
                <th style={{ textAlign:'left', padding:'10px 8px', fontSize:12, color:'#475569' }}></th>
                <th style={{ textAlign:'left', padding:'10px 8px', fontSize:12, color:'#475569' }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={7} style={{ padding:16, color:'#64748b' }}>Loading…</td></tr>
              ) : (turns.length === 0 ? (
                <tr><td colSpan={7} style={{ padding:16, color:'#64748b' }}>No turns match these filters.</td></tr>
              ) : (
                turns.map(t => (
                  <tr key={t.id} style={{ borderBottom:'1px solid #e5e7eb' }}>
                    <td style={{ padding:'10px 8px' }}><Badge status={t.status} /></td>
                    <td style={{ padding:'10px 8px' }}>
                      <Link href={`/turns/${t.id}/review`} style={{ color:'#0369a1', textDecoration:'none', fontWeight:700 }}>
                        {t.property_name || '—'}
                      </Link>
                      <div style={{ fontSize:12, color:'#64748b' }}>
                        Cleaner: {t.cleaner_name || '—'}
                      </div>
                    </td>
                    <td style={{ padding:'10px 8px' }}>
                      {t.turn_date || '—'}
                      <div style={{ fontSize:12, color:'#64748b' }}>
                        Submitted: {t.submitted_at ? new Date(t.submitted_at).toLocaleString() : '—'}
                      </div>
                    </td>
                    <td style={{ padding:'10px 8px' }}>{t.photo_count ?? 0}</td>
                    <td style={{ padding:'10px 8px' }}>{t.finding_count ?? 0}</td>
                    <td style={{ padding:'10px 8px' }}>
                      <Link href={`/turns/${t.id}/review`} style={{
                        display:'inline-block', padding:'8px 10px', border:'1px solid #e5e7eb', borderRadius:10,
                        textDecoration:'none', color:'#0f172a', background:'#fff'
                      }}>
                        Open Review →
                      </Link>
                    </td>
                    <td style={{ padding:'10px 8px', whiteSpace:'nowrap' }}>
                      {(t.status === 'submitted' || t.status === 'needs_fix') ? (
                        <>
                          <button
                            onClick={()=>act(t.id,'needs_fix')}
                            disabled={actingId === t.id}
                            style={{ padding:'8px 10px', marginRight:8, borderRadius:10, border:'1px solid #f59e0b', background:'#fffbeb', cursor:'pointer' }}
                          >
                            {actingId === t.id ? '…' : '🛠️ Needs Fix'}
                          </button>
                          <button
                            onClick={()=>act(t.id,'approved')}
                            disabled={actingId === t.id}
                            style={{ padding:'8px 10px', borderRadius:10, border:'1px solid #22c55e', background:'#ecfdf5', cursor:'pointer' }}
                          >
                            {actingId === t.id ? '…' : '✅ Approve'}
                          </button>
                        </>
                      ) : (
                        <span style={{ color:'#94a3b8' }}>—</span>
                      )}
                    </td>
                  </tr>
                ))
              ))}
            </tbody>
          </table>
        </div>

        <div style={{ marginTop:18 }}>
          <Link href="/managers" style={{ color:'#0369a1', textDecoration:'none' }}>← Back to Managers</Link>
        </div>
      </main>
    </div>
  );
}
