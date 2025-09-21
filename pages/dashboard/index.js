// pages/dashboard/index.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function Dashboard() {
  const router = useRouter();
  const [session, setSession] = useState(null);

  const [loading, setLoading] = useState(true);
  const [creating, setCreating] = useState(false);
  const [propName, setPropName] = useState('');
  const [propsList, setPropsList] = useState([]);
  const [msg, setMsg] = useState('');
  const [managerId, setManagerId] = useState(null);

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  // Ensure the user has a managers row; capture its id and load properties
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        const { data: m } = await supabase
          .from('managers')
          .select('id')
          .eq('user_id', session.user.id)
          .maybeSingle();

        let id = m?.id;
        if (!id) {
          const { data: created, error: cErr } = await supabase
            .from('managers')
            .insert({ user_id: session.user.id, name: session.user.email })
            .select('id')
            .single();
          if (cErr) throw cErr;
          id = created.id;
        }
        setManagerId(id);

        setLoading(true);
        const { data, error } = await supabase
          .from('properties')
          .select('id, name, created_at')
          .order('created_at', { ascending: false });
        if (error) throw error;
        setPropsList(data || []);
      } catch (e) {
        setMsg(e.message || 'Failed to initialize dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);

  async function createProperty(e) {
    e?.preventDefault?.();
    try {
      if (!propName.trim()) return setMsg('Enter a property name.');
      if (!managerId) return setMsg('Your account is initializing. Try again in a moment.');
      setCreating(true);
      setMsg('');
      const { data, error } = await supabase
        .from('properties')
        .insert({ name: propName.trim(), manager_id: managerId })
        .select('id')
        .single();
      if (error) throw error;

      setPropName('');
      setPropsList(prev => [{ id: data.id, name: propName.trim(), created_at: new Date().toISOString() }, ...prev]);
      router.push(`/properties/${data.id}/template`);
    } catch (e) {
      setMsg(e.message || 'Could not create property');
    } finally {
      setCreating(false);
    }
  }

  return (
    <ChromeDark title="Dashboard">
      <section style={ui.sectionGrid}>
        {/* Create Property */}
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Create a property</h2>
          <form onSubmit={createProperty}>
            <label htmlFor="propname" style={ui.label}>Property name</label>
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
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Your properties</h2>
          {loading ? (
            <div>Loading…</div>
          ) : propsList.length === 0 ? (
            <div style={ui.muted}>No properties yet. Create one above to get started.</div>
          ) : (
            <div style={{ display: 'grid', gap: 10, marginTop: 8 }}>
              {propsList.map(p => (
                <div key={p.id} style={{
                  display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                  gap: 8, border: '1px solid #1f2937', borderRadius: 12, padding: 12
                }}>
                  <div style={{ fontWeight: 600 }}>{p.name}</div>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                    <Link href={`/properties/${p.id}/template`} style={ui.btnSecondary}>Checklist</Link>
                    <Link href={`/properties/${p.id}/invite`} style={ui.btnSecondary}>Invite cleaner</Link>
                    <Link href={`/properties/${p.id}/start-turn`} style={ui.btnSecondary}>Start turn</Link>
                    <Link href={`/managers/turns`} style={ui.btnSecondary}>Review turns</Link>
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
