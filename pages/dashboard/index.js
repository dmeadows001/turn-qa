// pages/dashboard/index.js
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

const supabase = supabaseBrowser();

function GettingStartedModal({ storageKey, title, children }) {
  const [open, setOpen] = useState(false);
  const [dontShow, setDontShow] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seen = window.localStorage.getItem(storageKey);
      if (!seen) setOpen(true);
    } catch {
      // ignore
      setOpen(true);
    }
  }, [storageKey]);

  function dismiss() {
    try {
      if (dontShow && typeof window !== 'undefined') {
        window.localStorage.setItem(storageKey, '1');
      }
    } catch {
      // ignore
    }
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
    >
      <div style={{ ...ui.card, maxWidth: 720, width: '100%' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div>
            <h2 style={{ margin: 0 }}>Getting Started</h2>
            <div style={{ ...ui.subtle, marginTop: 6 }}>{title}</div>
          </div>
          <button type="button" onClick={dismiss} style={ui.btnSecondary} aria-label="Dismiss">
            ✕
          </button>
        </div>

        <div style={{ marginTop: 14, color: '#cbd5e1', lineHeight: 1.45 }}>
          {children}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', color: '#cbd5e1' }}>
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              style={{ transform: 'scale(1.05)' }}
            />
            Don&apos;t show this again
          </label>

          <button type="button" onClick={dismiss} style={ui.btnPrimary}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function Dashboard() {
  const router = useRouter();

  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [properties, setProperties] = useState([]);
  const [newName, setNewName] = useState('');

  async function loadProperties() {
    setLoading(true);
    setMsg('');
    try {
      const { data, error } = await supabase
        .from('properties')
        .select('id, name, created_at')
        .order('created_at', { ascending: false });
      if (error) throw error;
      setProperties(data || []);
    } catch (e) {
      setMsg(e.message || 'Failed to load properties');
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    loadProperties();
  }, []);

  const hasProperties = useMemo(() => (properties || []).length > 0, [properties]);

  async function createProperty(e) {
    e?.preventDefault?.();
    try {
      setMsg('');
      const name = newName.trim();
      if (!name) {
        setMsg('Please enter a property name.');
        return;
      }

      const { data, error } = await supabase
        .from('properties')
        .insert({ name })
        .select('id, name')
        .single();

      if (error) throw error;

      setNewName('');
      setMsg('Created ✅');

      // Send manager to template builder
      router.push(`/properties/${data.id}/template`);
    } catch (e) {
      setMsg(e.message || 'Create property failed');
    }
  }

  return (
    <ChromeDark title="Dashboard">
      <GettingStartedModal
        storageKey="turnqa_gs_manager_dashboard_v1"
        title="Create your first Property"
      >
        <div style={{ marginBottom: 10 }}>
          Enter your <b>Property Name</b>, then click <b>Create</b> to start building your TurnQA checklist.
        </div>
        <div style={{ ...ui.subtle }}>
          Example: “Scottsdale – 58th St” or “Glendale – Main House”
        </div>
      </GettingStartedModal>

      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Create a property</h2>
          <div style={ui.subtle}>Add your first property to start building a checklist.</div>

          <form onSubmit={createProperty} style={{ marginTop: 14 }}>
            <label style={ui.label}>Property name</label>
            <div style={ui.row}>
              <input
                type="text"
                style={{ ...ui.input, flex: 2, minWidth: 220 }}
                placeholder="e.g., Scottsdale – 58th St"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
              />
              <button type="submit" style={ui.btnPrimary}>
                Create &amp; build checklist
              </button>
            </div>
          </form>

          {msg && (
            <div style={{ marginTop: 10, color: msg.match(/✅|Created/i) ? '#22c55e' : '#fca5a5' }}>
              {msg}
            </div>
          )}
        </div>

        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Your properties</h2>
          {loading ? (
            <div>Loading…</div>
          ) : !hasProperties ? (
            <div style={ui.muted}>No properties yet. Create one above.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10 }}>
              {(properties || []).map((p) => (
                <div
                  key={p.id}
                  style={{
                    border: '1px solid #1f2937',
                    borderRadius: 12,
                    padding: 12,
                    background: '#0b1220',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    flexWrap: 'wrap',
                  }}
                >
                  <div>
                    <div style={{ fontWeight: 800, color: '#e5e7eb' }}>{p.name}</div>
                    <div style={{ ...ui.subtle }}>
                      Created: {p.created_at ? new Date(p.created_at).toLocaleString() : '—'}
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
                    <button
                      type="button"
                      onClick={() => router.push(`/properties/${p.id}/template`)}
                      style={ui.btnPrimary}
                    >
                      Build checklist
                    </button>
                    <button
                      type="button"
                      onClick={() => router.push(`/properties/${p.id}/start-turn`)}
                      style={ui.btnSecondary}
                    >
                      Start a test turn
                    </button>
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
