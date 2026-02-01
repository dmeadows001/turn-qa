// pages/managers/turns.js
import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

// ---- Error boundary so a render-time bug won't 500 the page ----
import React from 'react';
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, err: null };
  }
  static getDerivedStateFromError(err) {
    return { hasError: true, err };
  }
  componentDidCatch(err, info) {
    console.error('ManagerTurns render error:', err, info);
  }
  render() {
    if (this.state.hasError) {
      return (
        <ChromeDark title="Manager — Turns">
          <section style={ui.sectionGrid}>
            <div style={ui.card}>
              <div style={{ color: '#fca5a5', fontWeight: 700 }}>
                Something went wrong rendering this page.
              </div>
              <div style={{ color: '#94a3b8', marginTop: 8, whiteSpace: 'pre-wrap' }}>
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
  try {
    return new Date(s).toLocaleString();
  } catch {
    return s || '—';
  }
}

const statuses = [
  { v: '', label: 'Any' },
  { v: 'submitted', label: 'Submitted' },
  { v: 'needs_fix', label: 'Needs Fix' },
  { v: 'approved', label: 'Approved' },
  { v: 'in_progress', label: 'In Progress' },
  { v: 'cancelled', label: 'Cancelled' },
];

function pillStyle() {
  return {
    display: 'inline-flex',
    alignItems: 'center',
    gap: 8,
    padding: '6px 10px',
    borderRadius: 999,
    border: '1px solid #334155',
    background: '#0f172a',
    color: '#cbd5e1',
    fontSize: 12,
    fontWeight: 700,
  };
}

function ManagerTurnsInner() {
  const router = useRouter();

  // property scope from dashboard: /managers/turns?property_id=...
  const scopedPropertyId = useMemo(() => {
    const raw = router.query.property_id;
    const s = Array.isArray(raw) ? raw[0] : raw;
    return s ? String(s).trim() : '';
  }, [router.query.property_id]);

  const [status, setStatus] = useState('submitted');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return new Date(d).toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(() => new Date().toISOString().slice(0, 10));

  // when NOT scoped, allow property dropdown filtering
  const [propertyId, setPropertyId] = useState(''); // '' = all properties

  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  // If the URL is scoped, force the UI filter to match it (and lock it)
  useEffect(() => {
    if (scopedPropertyId) setPropertyId(scopedPropertyId);
    // if scope removed, keep propertyId as-is (user choice)
  }, [scopedPropertyId]);

  async function load() {
    setLoading(true);
    setErr('');
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (from) qs.set('from', `${from}T00:00:00Z`);
      if (to) qs.set('to', `${to}T23:59:59Z`);

      // ✅ apply property filter:
      // - if URL scoped, always use that
      // - else use dropdown selection (if any)
      const pid = scopedPropertyId || propertyId;
      if (pid) qs.set('property_id', pid);

      const r = await fetch(`/api/list-turns?${qs.toString()}`);

      // If this API throws a 500, surface the JSON error text in the UI:
      let j = {};
      try {
        j = await r.json();
      } catch {}

      if (!r.ok) throw new Error(j.error || `list-turns failed (${r.status})`);

      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e) {
      console.error('load /api/list-turns failed', e);
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  // initial load AND reload when the scope changes (dashboard -> property scoped)
  useEffect(() => {
    if (!router.isReady) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, scopedPropertyId]);

  const filtered = useMemo(() => rows, [rows]);

  // Build dropdown options from currently loaded rows (works fine for "Any" status too)
  const propertyOptions = useMemo(() => {
    const map = new Map();
    (rows || []).forEach((r) => {
      const pid = r.property_id ? String(r.property_id) : '';
      const name = r.property_name || '(unnamed)';
      if (pid && !map.has(pid)) map.set(pid, name);
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { numeric: true }));
  }, [rows]);

  const scopedPropertyName = useMemo(() => {
    if (!scopedPropertyId) return '';
    // Try to infer from loaded rows; if no rows, we still show "Property scoped"
    const match = (rows || []).find((r) => String(r.property_id || '') === String(scopedPropertyId));
    return match?.property_name || '';
  }, [rows, scopedPropertyId]);

  function clearScopeToAll() {
    // remove property_id from query but keep the rest of the page
    router.push('/managers/turns');
  }

  return (
    <ChromeDark title="Manager — Turns">
      <section style={ui.sectionGrid}>
        {/* Filters */}
        <div style={ui.card}>
          <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, flexWrap: 'wrap' }}>
            <h2 style={{ margin: 0 }}>Turns</h2>

            {/* Scope indicator */}
            {scopedPropertyId ? (
              <div style={{ display: 'flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
                <span style={pillStyle()}>
                  Viewing:{' '}
                  <span style={{ color: '#93c5fd' }}>
                    {scopedPropertyName ? scopedPropertyName : 'Selected property'}
                  </span>
                </span>
                <button type="button" onClick={clearScopeToAll} style={ui.btnSecondary}>
                  View all properties
                </button>
              </div>
            ) : null}
          </div>

          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))',
              gap: 12,
              marginTop: 12,
            }}
          >
            {/* ✅ Property filter (only when NOT scoped via dashboard) */}
            {!scopedPropertyId && (
              <div>
                <div style={ui.label}>Property</div>
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  style={{ ...ui.input, background: '#0b1220', cursor: 'pointer' }}
                >
                  <option value="">All properties</option>
                  {propertyOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
                <div style={{ ...ui.subtle, marginTop: 6 }}>
                  Tip: Use “Review turns” from a property on the dashboard to auto-scope.
                </div>
              </div>
            )}

            <div>
              <div style={ui.label}>Status</div>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ ...ui.input, background: '#0b1220', cursor: 'pointer' }}
              >
                {statuses.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div>
              <div style={ui.label}>From</div>
              <input type="date" value={from} onChange={(e) => setFrom(e.target.value)} style={ui.input} />
            </div>

            <div>
              <div style={ui.label}>To</div>
              <input type="date" value={to} onChange={(e) => setTo(e.target.value)} style={ui.input} />
            </div>

            <div style={{ alignSelf: 'end' }}>
              <button onClick={load} style={{ ...ui.btnPrimary, width: '100%' }}>
                {loading ? 'Loading…' : 'Apply filters'}
              </button>
            </div>
          </div>

          {err && <div style={{ color: '#fca5a5', marginTop: 12 }}>{err}</div>}
        </div>

        {/* Results */}
        <div style={ui.card}>
          {loading ? (
            <div>Loading…</div>
          ) : filtered.length === 0 ? (
            <div style={ui.muted}>No turns match these filters.</div>
          ) : (
            <div style={{ overflowX: 'auto' }}>
              <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 700 }}>
                <thead>
                  <tr style={{ textAlign: 'left', borderBottom: '1px solid #1f2937' }}>
                    <th style={{ padding: '10px 8px' }}>Created</th>
                    <th style={{ padding: '10px 8px' }}>Property</th>
                    <th style={{ padding: '10px 8px' }}>Status</th>
                    <th style={{ padding: '10px 8px' }}>Submitted</th>
                    <th style={{ padding: '10px 8px' }}></th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((t) => (
                    <tr key={t.id} style={{ borderBottom: '1px solid #111827' }}>
                      <td style={{ padding: '10px 8px', color: '#cbd5e1' }}>{niceDate(t.created_at)}</td>
                      <td style={{ padding: '10px 8px' }}>{t.property_name}</td>
                      <td style={{ padding: '10px 8px', textTransform: 'capitalize' }}>{t.status || '—'}</td>
                      <td style={{ padding: '10px 8px' }}>{t.submitted_at ? niceDate(t.submitted_at) : '—'}</td>
                      <td style={{ padding: '10px 8px' }}>
                        <Link
                          href={`/turns/${t.id}/review?manager=1`}
                          style={{ ...ui.btnSecondary, display: 'inline-block' }}
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
          <Link href="/managers" style={{ color: '#9ca3af' }}>
            ← Back to Managers home
          </Link>
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
