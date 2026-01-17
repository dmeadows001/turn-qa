// pages/dashboard/index.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

const GS_KEY = 'turnqa_gs_dashboard_v1';

export default function Dashboard() {
  const router = useRouter();
  const supabase = supabaseBrowser();

  const [session, setSession] = useState(null);
  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [propName, setPropName] = useState('');
  const [propsList, setPropsList] = useState([]);
  const [msg, setMsg] = useState('');
  const [managerId, setManagerId] = useState(null);

  // ✅ Phase 2: view toggle
  const [showArchived, setShowArchived] = useState(false);

  // Getting started modal
  const [showGettingStarted, setShowGettingStarted] = useState(false);
  const [dontShowAgain, setDontShowAgain] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const dismissed = window.localStorage.getItem(GS_KEY) === '1';
      setShowGettingStarted(!dismissed);
    } catch {
      setShowGettingStarted(true);
    }
  }, []);

  function dismissGettingStarted() {
    try {
      if (dontShowAgain && typeof window !== 'undefined') {
        window.localStorage.setItem(GS_KEY, '1');
      }
    } catch {}
    setShowGettingStarted(false);
  }

  function openGettingStarted() {
    setDontShowAgain(false); // default unchecked when opened manually
    setShowGettingStarted(true);
  }

  // keep session in sync
  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // bootstrap manager row (idempotent)
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('');

        const { data: existing, error: mErr } = await supabase
          .from('managers')
          .select('id')
          .eq('user_id', session.user.id);

        if (mErr) throw mErr;

        if (!existing || existing.length === 0) {
          const { error: insErr } = await supabase
            .from('managers')
            .upsert(
              { user_id: session.user.id, name: session.user.email || 'Manager' },
              { onConflict: 'user_id' }
            );
          if (insErr) throw insErr;
        } else if (existing.length > 1) {
          const keepId = existing[0].id;
          const extras = existing.slice(1).map(r => r.id);
          if (extras.length) {
            const { error: delErr } = await supabase.from('managers').delete().in('id', extras);
            if (delErr) throw delErr;
          }
          setManagerId(keepId);
        }

        const { data: one, error: oneErr } = await supabase
          .from('managers')
          .select('id')
          .eq('user_id', session.user.id)
          .single();
        if (oneErr) throw oneErr;
        setManagerId(one.id);
      } catch (e) {
        console.error('[dashboard bootstrap]', e);
        setMsg(e.message || 'Failed to initialize dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, [session, supabase]);

  // ✅ Phase 2: load properties whenever showArchived changes
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('');

        const { data: props, error: pErr } = await supabase
          .from('properties')
          .select('id, name, created_at, is_archived, archived_at')
          .eq('is_archived', showArchived ? true : false)
          .order(showArchived ? 'archived_at' : 'created_at', { ascending: false });

        if (pErr) throw pErr;
        setPropsList(props || []);
      } catch (e) {
        console.error('[dashboard load props]', e);
        setMsg(e.message || 'Failed to load properties');
      } finally {
        setLoading(false);
      }
    })();
  }, [session, supabase, showArchived]);

  // ✅ createProperty handler
  async function createProperty(e) {
    e?.preventDefault?.();
    try {
      if (!propName.trim()) return setMsg('Enter a property name.');
      if (!managerId) return setMsg('Your account is initializing. Try again in a moment.');
      setCreating(true);
      setMsg('');

      const name = propName.trim();

      const { data, error } = await supabase
        .from('properties')
        .insert({ name, manager_id: managerId })
        .select('id')
        .single();
      if (error) throw error;

      setPropName('');

      // If user is viewing archived right now, don't inject into that list
      if (!showArchived) {
        setPropsList(prev => [{ id: data.id, name, created_at: new Date().toISOString() }, ...prev]);
      }

      router.push(`/properties/${data.id}/template`);
    } catch (e) {
      setMsg(e.message || 'Could not create property');
    } finally {
      setCreating(false);
    }
  }

  async function archiveProperty(propertyId, propertyName) {
    try {
      const ok = window.confirm(
        `Archive "${propertyName}"?\n\nThis will remove it from your dashboard, but keep history in the database.`
      );
      if (!ok) return;

      setMsg('');

      const { error } = await supabase
        .from('properties')
        .update({ is_archived: true, archived_at: new Date().toISOString() })
        .eq('id', propertyId);

      if (error) throw error;

      // Remove from UI instantly
      setPropsList(prev => prev.filter(p => p.id !== propertyId));
    } catch (e) {
      console.error('[archiveProperty]', e);
      setMsg(e.message || 'Could not archive property');
    }
  }

  // ✅ Phase 2: restore
  async function restoreProperty(propertyId, propertyName) {
    try {
      const ok = window.confirm(
        `Restore "${propertyName}"?\n\nThis will move it back to your active properties.`
      );
      if (!ok) return;

      setMsg('');

      const { error } = await supabase
        .from('properties')
        .update({ is_archived: false, archived_at: null })
        .eq('id', propertyId);

      if (error) throw error;

      // Remove from archived UI instantly
      setPropsList(prev => prev.filter(p => p.id !== propertyId));
    } catch (e) {
      console.error('[restoreProperty]', e);
      setMsg(e.message || 'Could not restore property');
    }
  }

  return (
    <ChromeDark title="Dashboard">
      {/* Getting Started Modal */}
      {showGettingStarted && (
        <div
          style={{
            position: 'fixed',
            inset: 0,
            background: 'rgba(0,0,0,0.55)',
            zIndex: 9999,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 16,
          }}
          onClick={() => {
            // click outside closes (does NOT persist unless checkbox checked via Dismiss)
            setShowGettingStarted(false);
          }}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            style={{
              width: 'min(720px, 100%)',
              borderRadius: 16,
              border: '1px solid #334155',
              background: '#0b1220',
              boxShadow: '0 20px 60px rgba(0,0,0,0.55)',
              padding: 18,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
              <div style={{ fontSize: 22, fontWeight: 800, color: '#e5e7eb' }}>Getting Started</div>
              <button
                type="button"
                onClick={dismissGettingStarted}
                style={{
                  ...ui.btnSecondary,
                  padding: '8px 12px',
                  border: '1px solid #334155',
                  background: '#0f172a',
                  color: '#cbd5e1',
                }}
              >
                Dismiss
              </button>
            </div>

            <div style={{ marginTop: 10, color: '#cbd5e1', fontSize: 14, lineHeight: 1.45 }}>
              <div style={{ marginBottom: 10 }}>
                <b>Step 1:</b> Enter a property name above and click <b>Create & build checklist</b> to start building your
                TurnQA checklist.
              </div>
              <div style={{ marginBottom: 10 }}>
                <b>Step 2:</b> In your checklist, add sections (Kitchen, Master Bedroom, etc.) and the exact photos you want
                your cleaner to capture.
              </div>
              <div>
                <b>Step 3:</b> Use <b>Invite cleaner</b> to send your cleaner a secure link so they can complete turns.
              </div>
            </div>

            <label style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, cursor: 'pointer' }}>
              <input
                type="checkbox"
                checked={dontShowAgain}
                onChange={e => setDontShowAgain(!!e.target.checked)}
                style={{ transform: 'scale(1.1)' }}
              />
              <span style={{ color: '#94a3b8', fontSize: 13 }}>Don’t show this again</span>
            </label>
          </div>
        </div>
      )}

      <section style={ui.sectionGrid}>
        {/* Create Property */}
        <div style={ui.card}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Create a property</h2>

            <button
              type="button"
              onClick={openGettingStarted}
              style={{
                ...ui.btnSecondary,
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#cbd5e1'
              }}
              title="Help / Getting Started"
              aria-label="Help / Getting Started"
            >
              ❓ Help
            </button>
          </div>
          <form onSubmit={createProperty}>
            <label htmlFor="propname" style={ui.label}>
              Property name
            </label>
            <div style={{ ...ui.row }}>
              <input
                id="propname"
                type="text"
                placeholder="e.g., Glendale — 2BR Condo"
                style={{ ...ui.input, flex: 1, minWidth: 220 }}
                value={propName}
                onChange={e => setPropName(e.target.value)}
              />
              <button type="submit" disabled={creating} style={ui.btnPrimary}>
                {creating ? 'Creating…' : 'Create & build checklist'}
              </button>
            </div>
          </form>
          {msg && <div style={{ marginTop: 10, color: '#fca5a5' }}>{msg}</div>}
        </div>

        {/* Your Properties */}
        <div style={ui.card}>
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', gap: 12 }}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>Your properties</h2>

            {/* ✅ Phase 2 toggle */}
            <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 12, color: '#94a3b8' }}>View:</span>
              <button
                type="button"
                onClick={() => setShowArchived(false)}
                style={{
                  ...ui.btnSecondary,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: !showArchived ? '1px solid #22c55e' : ui.btnSecondary.border,
                  color: !showArchived ? '#bbf7d0' : ui.btnSecondary.color,
                  background: !showArchived ? 'rgba(34,197,94,0.12)' : ui.btnSecondary.background,
                }}
              >
                Active
              </button>
              <button
                type="button"
                onClick={() => setShowArchived(true)}
                style={{
                  ...ui.btnSecondary,
                  padding: '6px 10px',
                  borderRadius: 999,
                  border: showArchived ? '1px solid #f59e0b' : ui.btnSecondary.border,
                  color: showArchived ? '#fde68a' : ui.btnSecondary.color,
                  background: showArchived ? 'rgba(245,158,11,0.12)' : ui.btnSecondary.background,
                }}
              >
                Archived
              </button>
            </div>
          </div>

          {showArchived && (
            <div style={{ ...ui.subtle, marginTop: 6 }}>
              Archived properties are hidden from your main dashboard, but history is preserved.
            </div>
          )}

          {loading ? (
            <div>Loading…</div>
          ) : propsList.length === 0 ? (
            <div style={ui.muted}>
              {showArchived ? 'No archived properties yet.' : 'No properties yet. Create one above to get started.'}
            </div>
          ) : (
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              {propsList.map(p => (
                <div
                  key={p.id}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 8,
                    border: '1px solid #1f2937',
                    borderRadius: 12,
                    padding: 12,
                  }}
                >
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    {!showArchived ? (
                      <>
                        <Link href={`/properties/${p.id}/template`} style={ui.btnSecondary}>
                          Checklist
                        </Link>
                        <Link href={`/properties/${p.id}/invite`} style={ui.btnSecondary}>
                          Invite cleaner
                        </Link>
                       <Link href={`/managers/turns`} style={ui.btnSecondary}>
                          Review turns
                        </Link>

                        <button
                          type="button"
                          onClick={() => archiveProperty(p.id, p.name)}
                          style={{
                            ...ui.btnSecondary,
                            border: '1px solid #7f1d1d',
                            color: '#fecaca',
                            background: 'rgba(127, 29, 29, 0.15)',
                          }}
                        >
                          Archive
                        </button>
                      </>
                    ) : (
                      <>
                        <button
                          type="button"
                          onClick={() => restoreProperty(p.id, p.name)}
                          style={{
                            ...ui.btnSecondary,
                            border: '1px solid #065f46',
                            color: '#bbf7d0',
                            background: 'rgba(6, 95, 70, 0.15)',
                          }}
                        >
                          Restore
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </section>
    </ChromeDark>
  );
}

// ⛔ Prevent static optimization (force SSR for this page)
export async function getServerSideProps() {
  return { props: {} };
}
