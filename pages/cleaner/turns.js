// pages/cleaner/turns.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import CleanerMenu from '../../components/CleanerMenu';
import { ui } from '../../lib/theme';

function niceDate(s) {
  if (!s) return '—';
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleString();
}

function StatusBadge({ s }) {
  const map = {
    approved: {
      bg: '#064e3b',
      fg: '#86efac',
      bd: '#065f46',
      label: 'Approved',
    },
    submitted: {
      bg: '#0b3b72',
      fg: '#93c5fd',
      bd: '#1d4ed8',
      label: 'Submitted',
    },
    needs_fix: {
      bg: '#4a2f04',
      fg: '#fcd34d',
      bd: '#d97706',
      label: 'Needs Fix',
    },
    in_progress: {
      bg: '#1f2937',
      fg: '#cbd5e1',
      bd: '#334155',
      label: 'In Progress',
    },
    cancelled: {
      bg: '#4c0519',
      fg: '#fecdd3',
      bd: '#be123c',
      label: 'Cancelled',
    },
  };

  const c = map[s] || {
    bg: '#1f2937',
    fg: '#cbd5e1',
    bd: '#334155',
    label: s || '—',
  };

  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        background: c.bg,
        color: c.fg,
        border: `1px solid ${c.bd}`,
        padding: '7px 12px',
        borderRadius: 999,
        fontSize: 13,
        fontWeight: 700,
        lineHeight: 1.2,
        whiteSpace: 'nowrap',
      }}
    >
      {c.label}
    </span>
  );
}

function payoutText(row) {
  const s = (row.status || '').toLowerCase();

  if (s === 'approved') {
    return row.approved_at
      ? `Approved ${niceDate(row.approved_at)} — payout will be/was sent by your manager`
      : 'Approved — payout will be/was sent by your manager';
  }

  if (s === 'submitted') {
    return 'Pending — waiting on manager review';
  }

  if (s === 'needs_fix') {
    return 'On hold — manager requested fixes';
  }

  if (s === 'in_progress') {
    return 'Not submitted yet';
  }

  if (s === 'cancelled') {
    return 'Cancelled';
  }

  return '—';
}

function TurnCard({ turn }) {
  const isInProgress = turn.status === 'in_progress';
  const needsFix = turn.status === 'needs_fix';
  const requiresAction = isInProgress || needsFix;

  // Needs Fix must open the cleaner's task-focused correction workflow,
  // not the read-only review page.
  const destination = needsFix
    ? `/turns/${turn.id}/capture?tab=needs-fix`
    : isInProgress
      ? `/turns/${turn.id}/capture?from=capture`
      : `/turns/${turn.id}/review`;

  const actionLabel = needsFix
    ? 'Fix & Resubmit'
    : isInProgress
      ? 'Resume Turn'
      : 'View Turn';

  return (
    <article
      style={{
        background: '#0b1220',
        border: '1px solid #29364b',
        borderRadius: 16,
        padding: 16,
        minWidth: 0,
        overflowWrap: 'anywhere',
      }}
    >
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'flex-start',
          gap: 12,
          flexWrap: 'wrap',
          marginBottom: 14,
        }}
      >
        <div style={{ minWidth: 0, flex: '1 1 140px' }}>
          <div
            style={{
              fontSize: 12,
              color: '#94a3b8',
              marginBottom: 5,
            }}
          >
            PROPERTY
          </div>

          <div
            style={{
              fontSize: 20,
              fontWeight: 800,
              color: '#f8fafc',
              overflowWrap: 'anywhere',
            }}
          >
            {turn.property_name || 'Property'}
          </div>
        </div>

        <StatusBadge s={turn.status} />
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr)',
          gap: 12,
          padding: '14px 0',
          borderTop: '1px solid #1e293b',
          borderBottom: '1px solid #1e293b',
        }}
      >
        <div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Started
          </div>
          <div style={{ color: '#e2e8f0', fontSize: 14, marginTop: 4 }}>
            {niceDate(turn.created_at)}
          </div>
        </div>

        {turn.submitted_at && (
          <div>
            <div style={{ color: '#94a3b8', fontSize: 12 }}>
              Submitted
            </div>
            <div style={{ color: '#e2e8f0', fontSize: 14, marginTop: 4 }}>
              {niceDate(turn.submitted_at)}
            </div>
          </div>
        )}

        <div>
          <div style={{ color: '#94a3b8', fontSize: 12 }}>
            Payment status
          </div>
          <div
            style={{
              color: '#cbd5e1',
              fontSize: 14,
              lineHeight: 1.5,
              marginTop: 4,
            }}
          >
            {payoutText(turn)}
          </div>
        </div>
      </div>

      <a
        href={destination}
        style={{
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          width: '100%',
          boxSizing: 'border-box',
          minHeight: 50,
          marginTop: 16,
          padding: '12px 16px',
          borderRadius: 12,
          background: requiresAction ? '#0ea5e9' : '#172338',
          border: requiresAction
            ? '1px solid #38bdf8'
            : '1px solid #334155',
          color: requiresAction ? '#06121f' : '#f8fafc',
          fontSize: 16,
          fontWeight: 800,
          textDecoration: 'none',
          textAlign: 'center',
        }}
      >
        {actionLabel}
      </a>
    </article>
  );
}

export default function CleanerTurns() {
  const router = useRouter();

  const qPhone =
    typeof router.query.phone === 'string'
      ? router.query.phone.trim()
      : '';

  const [phone, setPhone] = useState(qPhone || '');
  const [rows, setRows] = useState([]);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState('');
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState('all');
  const [visibleCount, setVisibleCount] = useState(15);

  const needsFixCount = rows.filter(turn => turn.status === 'needs_fix').length;
  const filters = [
    { value: 'all', label: 'All' },
    { value: 'needs_fix', label: `Needs Fix (${needsFixCount})` },
    { value: 'active', label: 'Active' },
    { value: 'completed', label: 'Completed' },
  ];

  const filteredRows = rows
    .filter(turn => {
      if (statusFilter === 'needs_fix') return turn.status === 'needs_fix';
      if (statusFilter === 'active') return ['in_progress', 'submitted', 'needs_fix'].includes(turn.status);
      if (statusFilter === 'completed') return ['approved', 'cancelled'].includes(turn.status);
      return true;
    })
    .filter(turn => {
      const q = search.trim().toLowerCase();
      if (!q) return true;
      const dateText = [turn.created_at, turn.submitted_at, turn.approved_at]
        .filter(Boolean)
        .map(niceDate)
        .join(' ');
      const statusText = String(turn.status || '').replace(/_/g, ' ');
      return `${turn.property_name || ''} ${dateText} ${statusText}`.toLowerCase().includes(q);
    })
    .sort((a, b) => {
      // Bring actionable corrections to the top of the All/Active views.
      if (statusFilter === 'all' || statusFilter === 'active') {
        const priority = turn => turn.status === 'needs_fix' ? 0 : 1;
        if (priority(a) !== priority(b)) return priority(a) - priority(b);
      }
      return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
    });

  const visibleRows = filteredRows.slice(0, visibleCount);


  useEffect(() => {
    if (qPhone) {
      setPhone(qPhone);
      return;
    }

    try {
      const v = window.localStorage.getItem('turnqa_phone');
      if (v && v.trim()) {
        setPhone(current => current || v.trim());
      }
    } catch {}
  }, [qPhone]);

  async function load() {
    if (!phone.trim()) {
      setRows([]);
      return;
    }

    setLoading(true);
    setErr('');

    try {
      const u = new URL(
        '/api/list-cleaner-turns',
        window.location.origin
      );

      u.searchParams.set('phone', phone.trim());

      const r = await fetch(u.toString());
      const j = await r.json();

      if (!r.ok) {
        throw new Error(j.error || 'Load failed');
      }

      setRows(j.rows || []);
      setVisibleCount(15);

      try {
        window.localStorage.setItem(
          'turnqa_phone',
          phone.trim()
        );
      } catch {}
    } catch (e) {
      setErr(e.message || 'Failed to load');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    if (phone) load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phone]);

  return (
    <ChromeDark title="My turns" headerAction={<CleanerMenu />}>
      <section
        style={{
          ...ui.sectionGrid,
          width: '100%',
          maxWidth: 760,
          minWidth: 0,
          margin: '0 auto',
          boxSizing: 'border-box',
        }}
      >
        <div
          style={{
            ...ui.card,
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          <h2
            style={{
              marginTop: 0,
              marginBottom: 8,
              fontSize: 22,
              textAlign: 'center',
            }}
          >
            My Turns
          </h2>

          <p
            style={{
              ...ui.muted,
              marginTop: 6,
              textAlign: 'center',
              lineHeight: 1.5,
            }}
          >
            Find your turnovers, complete requested corrections,
            and review submitted jobs.
          </p>

          <div
            style={{
              marginTop: 16,
              display: 'flex',
              flexWrap: 'wrap',
              gap: 8,
              minWidth: 0,
            }}
          >
            <input
              type="tel"
              value={phone}
              onChange={e => setPhone(e.target.value)}
              placeholder="Your phone number"
              style={{
                ...ui.input,
                flex: '1 1 190px',
                width: '100%',
                minWidth: 0,
                boxSizing: 'border-box',
              }}
            />

            <button
              onClick={load}
              disabled={loading}
              style={{
                ...ui.btnPrimary,
                flex: '1 1 90px',
                minHeight: 46,
                cursor: loading ? 'wait' : 'pointer',
              }}
            >
              {loading ? 'Loading…' : 'Load Turns'}
            </button>
          </div>

          {err && (
            <div
              role="alert"
              style={{
                color: '#fca5a5',
                marginTop: 12,
                overflowWrap: 'anywhere',
              }}
            >
              {err}
            </div>
          )}
        </div>

        <div
          style={{
            ...ui.card,
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          {rows.length > 0 && (
            <div style={{ marginBottom: 20 }}>
              {needsFixCount > 0 && (
                <button
                  type="button"
                  onClick={() => { setStatusFilter('needs_fix'); setVisibleCount(15); }}
                  style={{
                    width: '100%', padding: '13px 14px', marginBottom: 16,
                    textAlign: 'left', background: '#4a2f04', color: '#fde68a',
                    border: '1px solid #d97706', borderRadius: 12,
                    fontWeight: 700, cursor: 'pointer', fontSize: 14,
                  }}
                >
                  ⚠ {needsFixCount} {needsFixCount === 1 ? 'turn needs' : 'turns need'} corrections — view now
                </button>
              )}
              <label htmlFor="turn-search" style={{ display: 'block', color: '#cbd5e1', fontSize: 13, marginBottom: 7 }}>
                Search your turns
              </label>
              <input
                id="turn-search"
                type="search"
                value={search}
                onChange={e => { setSearch(e.target.value); setVisibleCount(15); }}
                placeholder="Property name or date (e.g., 1460 Rifle, 11/16)"
                style={{ ...ui.input, width: '100%', boxSizing: 'border-box', minWidth: 0 }}
              />
              <p style={{ color: '#94a3b8', fontSize: 12, margin: '8px 0 0', lineHeight: 1.5 }}>
                Results update as you type. Use the filters below to find turns by status.
              </p>
              <div role="group" aria-label="Filter turns by status" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 14 }}>
                {filters.map(filter => {
                  const selected = statusFilter === filter.value;
                  return (
                    <button
                      type="button"
                      key={filter.value}
                      aria-pressed={selected}
                      onClick={() => { setStatusFilter(filter.value); setVisibleCount(15); }}
                      style={{
                        borderRadius: 999, padding: '9px 12px', fontSize: 13,
                        fontWeight: 700, cursor: 'pointer',
                        background: selected ? '#0ea5e9' : '#0b1220',
                        color: selected ? '#06121f' : '#cbd5e1',
                        border: selected ? '1px solid #38bdf8' : '1px solid #334155',
                      }}
                    >
                      {filter.label}
                    </button>
                  );
                })}
              </div>
              <div style={{ color: '#94a3b8', fontSize: 13, marginTop: 12 }}>
                Showing {Math.min(visibleCount, filteredRows.length)} of {filteredRows.length} matching turns
                {(statusFilter === 'all' || statusFilter === 'active') && needsFixCount > 0 ? ' · Needs Fix first' : ' · Newest first'}
              </div>
            </div>
          )}
          {loading ? (
            <div>Loading turns…</div>
          ) : !phone ? (
            <div style={ui.muted}>
              Enter your phone number to see your turnovers.
            </div>
          ) : rows.length === 0 ? (
            <div style={ui.muted}>
              No turns found.
            </div>
          ) : filteredRows.length === 0 ? (
            <div style={ui.muted}>
              No turns match your search or filter.
            </div>
          ) : (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(0, 1fr)',
                gap: 14,
                minWidth: 0,
              }}
            >
              {visibleRows.map(turn => (
                <TurnCard key={turn.id} turn={turn} />
              ))}
              {filteredRows.length > visibleCount && (
                <button
                  type="button"
                  onClick={() => setVisibleCount(count => count + 15)}
                  style={{
                    ...ui.btnPrimary,
                    minHeight: 48,
                    cursor: 'pointer',
                    width: '100%',
                  }}
                >
                  Load 15 more turns
                </button>
              )}
            </div>
          )}
        </div>

        <div
          style={{
            ...ui.subtle,
            minWidth: 0,
            boxSizing: 'border-box',
          }}
        >
          Select a turn above to resume work, fix requested photos, or view its history.
        </div>
      </section>
    </ChromeDark>
  );
}
