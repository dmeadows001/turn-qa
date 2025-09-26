// pages/cleaner/turns.js
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

function niceDate(s) {
  try { return new Date(s).toLocaleString(); } catch { return s || '—'; }
}

function StatusBadge({ s }) {
  const map = {
    approved:  { bg:'#dcfce7', fg:'#166534', label:'Approved' },
    submitted: { bg:'#dbeafe', fg:'#1e3a8a', label:'Submitted' },
    needs_fix: { bg:'#fef3c7', fg:'#92400e', label:'Needs Fix' },
    in_progress:{ bg:'#e2e8f0', fg:'#334155', label:'In Progress' },
    cancelled: { bg:'#fee2e2', fg:'#991b1b', label:'Cancelled' },
  };
  const c = map[s] || { bg:'#f1f5f9', fg:'#334155', label:s || '—' };
  return (
    <span style={{ background:c.bg, color:c.fg, padding:'2px 8px', borderRadius:999, fontSize:12, fontWeight:700 }}>
      {c.label}
    </span>
  );
}

export default function CleanerTurns() {
  const router = useRouter();
  const qPhone = typeof router.query.phone === 'string' ? router.query.phone.trim() : '';
  const [phone, setPhone] = useState(qPhone || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // If no phone is in query, try localStorage
  useEffect(() => {
    if (qPhone) return;
    try {
      const v = window.localStorage.getItem('turnqa_phone');
      if (v && v.trim() && !phone) setPhone(v.trim());
    } catch {}
  }, [qPhone, phone]);

  async function load() {
    if (!phone) { setRows([]); return; }
    setLoading(true); setErr('');
    try {
      const u = new URL('/api/list-cleaner-turns', window.location.origin);
      u.searchParams.set('phone', phone);
      const r = await fetch(u.toString());
      const j = await r.json();
      if (!r.ok) throw new Error(j.error || 'load failed');
      setRows(j.rows || []);
      // persist the phone for convenience
      try { window.localStorage.setItem('turnqa_phone', phone); } catch {}
    } catch (e) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { if (phone) load(); /* eslint-disable-next-line */ }, [phone]);

  const hasPhone = !!phone;

  return (
    <ChromeDark title="My turns">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ marginTop:0, textAlign:'center' }}>My submitted turns</h2>
          <p style={{ ...ui.muted, marginTop:6, textAlign:'center' }}>
            View your recent submissions and status. Managers approve here when everything looks good.
          </p>

          {/* Phone entry (only shown if missing or the user wants to change it) */}
          <div style={{ marginTop:12, display:'grid', gridTemplateColumns:'1fr auto', gap:8 }}>
            <input
              value={phone}
              onChange={e=>setPhone(e.target.value)}
              placeholder="+1 555 123 4567"
              style={ui.input}
            />
            <button onClick={load} style={ui.btnPrimary}>{loading ? 'Loading…' : 'Load'}</button>
          </div>
          {err && <div style={{ color:'#fca5a5', marginTop:10 }}>{err}</div>}
        </div>

        <div style={ui.card}>
          {loading ? (
            <div>Loading…</div>
          ) : !hasPhone ? (
            <div style={ui.muted}>Enter your phone number to see your history.</div>
          ) : rows.length === 0 ? (
            <div style={ui.muted}>No turns yet.</div>
          ) : (
            <div style={{ overflowX:'auto' }}>
              <table style={{ width:'100%', borderCollapse:'collapse', minWidth: 720 }}>
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
                  {rows.map(t => (
                    <tr key={t.id} style={{ borderBottom:'1px solid #111827' }}>
                      <td style={{ padding:'10px 8px', color:'#cbd5e1' }}>{niceDate(t.created_at)}</td>
                      <td style={{ padding:'10px 8px' }}>{t.property_name}</td>
                      <td style={{ padding:'10px 8px' }}><StatusBadge s={t.status} /></td>
                      <td style={{ padding:'10px 8px' }}>{t.submitted_at ? niceDate(t.submitted_at) : '—'}</td>
                      <td style={{ padding:'10px 8px' }}>
                        {/* Read-only review page (manager controls hidden by your guard) */}
                        <a href={`/turns/${t.id}/review`} style={ui.btnSecondary}>Open</a>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <div style={{ ...ui.subtle }}>
          <a href="/capture" style={{ color:'#9ca3af' }}>← Back to capture</a>
        </div>
      </section>
    </ChromeDark>
  );
}
