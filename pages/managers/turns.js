
 // pages/managers/turns.js
import React, { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// Keep the existing error boundary.
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
              <strong style={{ color: '#fca5a5' }}>
                Something went wrong rendering this page.
              </strong>
              <div style={{ color: '#94a3b8', marginTop: 8 }}>
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

function niceDate(value) {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? String(value)
    : date.toLocaleString();
}

const statuses = [
  { v: '', label: 'Any' },
  { v: 'submitted', label: 'Submitted' },
  { v: 'needs_fix', label: 'Needs Fix' },
  { v: 'approved', label: 'Approved' },
  { v: 'in_progress', label: 'In Progress' },
  { v: 'cancelled', label: 'Cancelled' },
];

const statusColors = {
  submitted: { bg: '#123b73', fg: '#93c5fd', bd: '#2563eb', label: 'Submitted' },
  needs_fix: { bg: '#4a2f04', fg: '#fcd34d', bd: '#d97706', label: 'Needs Fix' },
  approved: { bg: '#064e3b', fg: '#86efac', bd: '#059669', label: 'Approved' },
  in_progress: { bg: '#1f2937', fg: '#cbd5e1', bd: '#475569', label: 'In Progress' },
  cancelled: { bg: '#4c0519', fg: '#fecdd3', bd: '#be123c', label: 'Cancelled' },
};

function StatusBadge({ status }) {
  const c = statusColors[status] || {
    bg: '#1f2937',
    fg: '#cbd5e1',
    bd: '#475569',
    label: status || 'Unknown',
  };

  return (
    <span style={{
      display: 'inline-flex',
      alignItems: 'center',
      padding: '7px 12px',
      borderRadius: 999,
      background: c.bg,
      color: c.fg,
      border: `1px solid ${c.bd}`,
      fontWeight: 700,
      fontSize: 13,
      whiteSpace: 'nowrap',
    }}>
      {c.label}
    </span>
  );
}

function TurnCard({ turn }) {
  return (
    <article style={{
      background: '#0b1220',
      border: '1px solid #29364e',
      borderRadius: 18,
      padding: 18,
      minWidth: 0,
    }}>
      <div style={{
        display: 'flex',
        justifyContent: 'space-between',
        alignItems: 'flex-start',
        gap: 12,
        flexWrap: 'wrap',
      }}>
        <div style={{ minWidth: 0 }}>
          <div style={{
            fontSize: 12,
            color: '#94a3b8',
            textTransform: 'uppercase',
            letterSpacing: '.05em',
          }}>
            Property
          </div>
          <div style={{
            fontSize: 23,
            fontWeight: 800,
            color: '#f8fafc',
            overflowWrap: 'anywhere',
            marginTop: 4,
          }}>
            {turn.property_name || 'Unnamed property'}
          </div>
        </div>
        <StatusBadge status={turn.status} />
      </div>

      <div style={{
        borderTop: '1px solid #243247',
        marginTop: 16,
        paddingTop: 16,
        display: 'grid',
        gap: 14,
      }}>
        <div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Started
          </div>
          <div style={{ color: '#e2e8f0', marginTop: 4 }}>
            {niceDate(turn.created_at)}
          </div>
        </div>

        <div>
          <div style={{ color: '#94a3b8', fontSize: 13 }}>
            Submitted
          </div>
          <div style={{ color: '#e2e8f0', marginTop: 4 }}>
            {niceDate(turn.submitted_at)}
          </div>
        </div>
      </div>

      <div style={{
        borderTop: '1px solid #243247',
        marginTop: 18,
        paddingTop: 18,
      }}>
        <Link
          href={`/turns/${turn.id}/review?manager=1`}
          style={{
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            width: '100%',
            boxSizing: 'border-box',
            minHeight: 50,
            padding: '12px 16px',
            borderRadius: 12,
            border: '1px solid #334155',
            background: turn.status === 'submitted'
              ? '#0ea5e9'
              : '#18253b',
            color: turn.status === 'submitted'
              ? '#07121f'
              : '#f8fafc',
            fontSize: 16,
            fontWeight: 800,
            textDecoration: 'none',
            textAlign: 'center',
          }}
        >
          {turn.status === 'submitted' || turn.status === 'needs_fix'
            ? 'Review Turn'
            : 'View Turn'}
        </Link>
      </div>
    </article>
  );
}

function ManagerTurnsInner() {
  const router = useRouter();
  const [billingChecked, setBillingChecked] = useState(false);

  // Preserve existing manager subscription check.
  useEffect(() => {
    if (!router.isReady) return;

    (async () => {
      try {
        const sb = supabaseBrowser();
        const { data: { session } } = await sb.auth.getSession();
        const token = session?.access_token;

        const r = await fetch('/api/billing/status', {
          headers: token
            ? { Authorization: `Bearer ${token}` }
            : {},
        });

        if (r.status === 401) {
          router.replace('/login');
          return;
        }

        const j = await r.json().catch(() => ({}));

        if (!r.ok) {
          throw new Error(j.error || `billing/status failed (${r.status})`);
        }

        if (j.allowed === false) {
          router.replace('/billing?reason=expired');
          return;
        }

        setBillingChecked(true);
      } catch (e) {
        console.warn(
          '[managers/turns] billing check failed:',
          e?.message || e
        );
        setBillingChecked(true);
      }
    })();
  }, [router.isReady, router]);

  const scopedPropertyId = useMemo(() => {
    const raw = router.query.property_id;
    const value = Array.isArray(raw) ? raw[0] : raw;
    return value ? String(value).trim() : '';
  }, [router.query.property_id]);

  const [status, setStatus] = useState('submitted');
  const [from, setFrom] = useState(() => {
    const d = new Date();
    d.setMonth(d.getMonth() - 1);
    return d.toISOString().slice(0, 10);
  });
  const [to, setTo] = useState(
    () => new Date().toISOString().slice(0, 10)
  );

  const [propertyId, setPropertyId] = useState('');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (scopedPropertyId) setPropertyId(scopedPropertyId);
  }, [scopedPropertyId]);

  // Preserve the existing API and filter behavior.
  async function load() {
    setLoading(true);
    setErr('');

    try {
      const qs = new URLSearchParams();

      if (status) qs.set('status', status);
      if (from) qs.set('from', `${from}T00:00:00Z`);
      if (to) qs.set('to', `${to}T23:59:59Z`);

      const pid = scopedPropertyId || propertyId;
      if (pid) qs.set('property_id', pid);

      const sb = supabaseBrowser();
      const { data: { session } } = await sb.auth.getSession();
      const token = session?.access_token;

      const r = await fetch(`/api/list-turns?${qs.toString()}`, {
        headers: token
          ? { Authorization: `Bearer ${token}` }
          : {},
      });

      const j = await r.json().catch(() => ({}));

      if (r.status === 402) {
        router.replace('/billing?reason=expired');
        return;
      }

      if (!r.ok) {
        throw new Error(j.error || `list-turns failed (${r.status})`);
      }

      setRows(Array.isArray(j.rows) ? j.rows : []);
    } catch (e) {
      console.error('load /api/list-turns failed', e);
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (!router.isReady) return;
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [router.isReady, scopedPropertyId]);

  const propertyOptions = useMemo(() => {
    const map = new Map();

    rows.forEach((r) => {
      const id = r.property_id ? String(r.property_id) : '';
      if (id && !map.has(id)) {
        map.set(id, r.property_name || '(unnamed)');
      }
    });

    return Array.from(map.entries())
      .map(([id, name]) => ({ id, name }))
      .sort((a, b) =>
        a.name.localeCompare(b.name, undefined, { numeric: true })
      );
  }, [rows]);

  const scopedPropertyName = useMemo(() => {
    if (!scopedPropertyId) return '';
    const match = rows.find(
      (r) => String(r.property_id || '') === scopedPropertyId
    );
    return match?.property_name || '';
  }, [rows, scopedPropertyId]);

  const fieldStyle = {
    ...ui.input,
    display: 'block',
    width: '100%',
    minWidth: 0,
    maxWidth: '100%',
    boxSizing: 'border-box',
    background: '#0b1220',
  };

  if (!billingChecked) {
    return (
      <ChromeDark title="Manager — Turns">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Checking subscription…</div>
        </section>
      </ChromeDark>
    );
  }

  return (
    <ChromeDark title="Manager — Turns">
      <section style={{
        ...ui.sectionGrid,
        minWidth: 0,
        width: '100%',
        boxSizing: 'border-box',
      }}>
        {/* Filters */}
        <div style={{ ...ui.card, minWidth: 0 }}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>
            Review Turns
          </h2>

          <p style={{ color: '#94a3b8', marginTop: 0 }}>
            Find turnovers, review photos, and track approvals.
          </p>

          {scopedPropertyId && (
            <div style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
              marginBottom: 16,
              padding: 12,
              background: '#0b1220',
              border: '1px solid #334155',
              borderRadius: 12,
            }}>
              <span style={{ color: '#93c5fd', fontWeight: 700 }}>
                Viewing: {scopedPropertyName || 'Selected property'}
              </span>
              <button
                type="button"
                onClick={() => router.push('/managers/turns')}
                style={{
                  ...ui.btnSecondary,
                  width: '100%',
                  boxSizing: 'border-box',
                }}
              >
                View all properties
              </button>
            </div>
          )}

          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 220px), 1fr))',
            gap: 14,
            marginTop: 16,
            minWidth: 0,
          }}>
            {!scopedPropertyId && (
              <div style={{ minWidth: 0 }}>
                <label style={ui.label}>Property</label>
                <select
                  value={propertyId}
                  onChange={(e) => setPropertyId(e.target.value)}
                  style={fieldStyle}
                >
                  <option value="">All properties</option>
                  {propertyOptions.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div style={{ minWidth: 0 }}>
              <label style={ui.label}>Status</label>
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={fieldStyle}
              >
                {statuses.map((s) => (
                  <option key={s.v} value={s.v}>
                    {s.label}
                  </option>
                ))}
              </select>
            </div>

            <div style={{ minWidth: 0 }}>
              <label style={ui.label}>From</label>
              <input
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                style={fieldStyle}
              />
            </div>

            <div style={{ minWidth: 0 }}>
              <label style={ui.label}>To</label>
              <input
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                style={fieldStyle}
              />
            </div>
          </div>

          <button
            type="button"
            onClick={load}
            disabled={loading}
            style={{
              ...ui.btnPrimary,
              display: 'block',
              width: '100%',
              boxSizing: 'border-box',
              marginTop: 18,
              minHeight: 48,
              fontWeight: 700,
            }}
          >
            {loading ? 'Loading…' : 'Apply Filters'}
          </button>

          {err && (
            <div style={{ color: '#fca5a5', marginTop: 12 }}>
              {err}
            </div>
          )}
        </div>

        {/* Mobile-friendly result cards */}
        <div style={{ ...ui.card, minWidth: 0 }}>
          <div style={{
            display: 'flex',
            justifyContent: 'space-between',
            alignItems: 'center',
            gap: 10,
            flexWrap: 'wrap',
            marginBottom: 16,
          }}>
            <h2 style={{ margin: 0 }}>Turnovers</h2>
            {!loading && (
              <span style={{ color: '#94a3b8', fontSize: 14 }}>
                {rows.length} {rows.length === 1 ? 'turn' : 'turns'}
              </span>
            )}
          </div>

          {loading ? (
            <div style={{ color: '#94a3b8' }}>Loading…</div>
          ) : rows.length === 0 ? (
            <div style={{ color: '#94a3b8', padding: '12px 0' }}>
              No turns match these filters.
            </div>
          ) : (
            <div style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 300px), 1fr))',
              gap: 14,
              minWidth: 0,
            }}>
              {rows.map((turn) => (
                <TurnCard key={turn.id} turn={turn} />
              ))}
            </div>
          )}
        </div>

        <div style={ui.subtle}>
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
