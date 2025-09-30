// pages/dashboard/index.js
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/router';
import ChromeDark from '../../components/ChromeDark';
import { ui } from '../../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

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

  // keep session in sync
  useEffect(() => {
    if (!session) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('');

        // 1) Ensure ONE managers row for this user (idempotent)
        const { data: existing, error: mErr } = await supabase
          .from('managers')
          .select('id')
          .eq('user_id', session.user.id);

        if (mErr) throw mErr;

        if (!existing || existing.length === 0) {
          // create one
          const { error: insErr } = await supabase
            .from('managers')
            .upsert(
              { user_id: session.user.id, name: session.user.email || 'Manager' },
              { onConflict: 'user_id' } // requires UNIQUE(user_id)
            );
          if (insErr) throw insErr;
        } else if (existing.length > 1) {
          // if duplicates slipped in, keep first and delete rest (defensive)
          const keepId = existing[0].id;
          const extras = existing.slice(1).map(r => r.id);
          if (extras.length) {
            const { error: delErr } = await supabase
              .from('managers')
              .delete()
              .in('id', extras);
            if (delErr) throw delErr;
          }
        }

        // reselect the single id (now guaranteed)
        const { data: one, error: oneErr } = await supabase
          .from('managers')
          .select('id')
          .eq('user_id', session.user.id)
          .single(); // safe now
        if (oneErr) throw oneErr;

        setManagerId(one.id);

        // 2) Load properties list
        const { data: props, error: pErr } = await supabase
          .from('properties')
          .select('id, name, created_at')
          .order('created_at', { ascending: false });
        if (pErr) throw pErr;

        setPropsList(props || []);
      } catch (e) {
        console.error('[dashboard bootstrap]', e);
        setMsg(e.message || 'Failed to initialize dashboard');
      } finally {
        setLoading(false);
      }
    })();
  }, [session]);


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
                <div
                  key={p.id}
                  style={{
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    gap: 8, border: '1px solid #1f2937', borderRadius: 12, padding: 12
                  }}
                >
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
