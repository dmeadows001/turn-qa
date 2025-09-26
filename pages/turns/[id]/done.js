// pages/turns/[id]/done.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

function Button({ href = '#', children, kind = 'primary' }) {
  const base = {
    display: 'inline-flex',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '12px 16px',
    borderRadius: 12,
    fontWeight: 700,
    textDecoration: 'none',
    border: '1px solid transparent',
    marginRight: 10,
  };
  const variants = {
    primary: { background: '#0ea5e9', color: '#fff' },
    secondary: { background: '#111827', color: '#e5e7eb', border: '1px solid #334155' },
  };
  return (
    <a href={href} style={{ ...base, ...(variants[kind] || variants.primary) }}>
      {children}
    </a>
  );
}

export default function TurnDone() {
  const router = useRouter();
  const turnId = router.query.id;

  const [propName, setPropName] = useState('');
  const [checklistName, setChecklistName] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!turnId) return;

    (async () => {
      try {
        // Reuse the turn-template endpoint to get display context (property + checklist)
        const r = await fetch(`/api/turn-template?turnId=${turnId}`);
        const j = await r.json().catch(() => ({}));
        const rules = j?.rules || {};
        setPropName(rules.property || '');
        setChecklistName(rules.template || '');
      } catch (_) {
        // ignore – we still show a themed success screen
      } finally {
        setLoading(false);
      }
    })();
  }, [turnId]);

  return (
    <ChromeDark title="Turn submitted">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ textAlign: 'center', margin: '0 0 6px' }}>Turn submitted</h2>

          {propName ? (
            <div style={{ textAlign: 'center', color: '#94a3b8', marginBottom: 6 }}>
              {propName}
              {checklistName ? <span> • <b>{checklistName}</b></span> : null}
            </div>
          ) : null}

          <div
            style={{
              marginTop: 12,
              background: '#052e1a',
              border: '1px solid #065f46',
              color: '#d1fae5',
              borderRadius: 12,
              padding: 12,
            }}
          >
            ✅ Your photos were submitted successfully.
            {turnId ? (
              <span style={{ color: '#a7f3d0' }}>
                {' '}Keep this turn ID for reference: <code style={{ userSelect: 'all' }}>{turnId}</code>
              </span>
            ) : null}
          </div>

          {!loading && (
            <div style={{ marginTop: 16, display: 'flex', flexWrap: 'wrap', gap: 10 }}>
              <Button href="/capture">Start another turn</Button>
              <Button href="/" kind="secondary">Back home</Button>
              {/* Manager deep-link (works only if the viewer is a manager): */}
              {turnId ? (
                <Button href={`/turns/${turnId}/review?manager=1`} kind="secondary">
                  View review page
                </Button>
              ) : null}
            </div>
          )}

          <div style={{ color: '#94a3b8', marginTop: 14, fontSize: 14 }}>
            You’ll get a text when the manager reviews your turn.
          </div>
        </div>
      </section>
    </ChromeDark>
  );
}
