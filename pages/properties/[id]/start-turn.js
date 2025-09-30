// pages/properties/[id]/start-turn.js
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/router';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function StartTurnPage() {
  const router = useRouter();
  const { id: propertyId } = router.query;
  const supabase = supabaseBrowser();

  const [loading, setLoading] = useState(true);
  const [property, setProperty] = useState(null);
  const [links, setLinks] = useState({});
  const [msg, setMsg] = useState('');

  // Cleaners linked to this property
  const [pcRows, setPcRows] = useState([]); // [{ cleaner_id, cleaners: { id, name, phone } }]
  const [selectedCleanerId, setSelectedCleanerId] = useState('');
  const [notes, setNotes] = useState('');
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('Loading…');

        // 1) Property
        const { data: prop, error: pErr } = await supabase
          .from('properties')
          .select('id, name')
          .eq('id', propertyId)
          .single();
        if (pErr) throw pErr;
        setProperty(prop);

        // 2) Cleaners assigned to this property
        const { data: rels, error: rErr } = await supabase
          .from('property_cleaners')
          .select('cleaner_id, cleaners:cleaner_id ( id, name, phone )')
          .eq('property_id', propertyId)
          .order('cleaner_id', { ascending: true });
        if (rErr) throw rErr;

        setPcRows(rels || []);
        setSelectedCleanerId((rels && rels[0]?.cleaner_id) || '');
        setMsg('');
      } catch (e) {
        setMsg(e.message || 'Failed to load start-turn data');
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId, supabase]);

  const cleaners = useMemo(() => {
    return (pcRows || []).map(r => ({
      id: r.cleaners?.id || r.cleaner_id,
      name: r.cleaners?.name || 'Unnamed cleaner',
      phone: r.cleaners?.phone || ''
    }));
  }, [pcRows]);

  async function startTurn(e) {
    e?.preventDefault?.();
    try {
      setMsg('');
      if (!selectedCleanerId) throw new Error('Select a cleaner.');
      setStarting(true);

      // Calls your server route that creates a turn and (optionally) sends SMS
      const resp = await fetch('/api/start-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          property_id: propertyId,
          cleaner_id: selectedCleanerId,
          notes: notes || ''
        })
      });
      const json = await resp.json().catch(() => ({}));
      if (!resp.ok) throw new Error(json.error || 'Could not start turn');

      setLinks(json); // { ok, turn_id, capture_url, sms }
      setMsg('Turn started ✅');
    } catch (e) {
      setMsg(e.message || 'Failed to start turn');
    } finally {
      setStarting(false);
    }
  }

  if (loading) {
    return (
      <ChromeDark title="Start Turn">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  if (!property) {
    return (
      <ChromeDark title="Start Turn">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Property not found.</div>
        </section>
      </ChromeDark>
    );
  }

  return (
    <ChromeDark title={`Start Turn — ${property.name}`}>
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>
            Start a turn at <span style={{ color: '#cbd5e1' }}>{property.name}</span>
          </h2>
          <div style={ui.subtle}>
            Pick a cleaner and (optionally) add notes. We’ll create a new turn and send the capture link.
          </div>

          {cleaners.length === 0 ? (
            <div style={{ marginTop: 12 }}>
              <div style={{ color: '#fca5a5', marginBottom: 8 }}>
                No cleaners are assigned to this property yet.
              </div>
              <div style={ui.row}>
                <button onClick={() => router.push(`/properties/${property.id}/invite`)} style={ui.btnPrimary}>
                  Invite a cleaner
                </button>
                <button onClick={() => router.push(`/properties/${property.id}/template`)} style={ui.btnSecondary}>
                  Back to template
                </button>
              </div>
            </div>
          ) : (
            <>
              <form onSubmit={startTurn} style={{ marginTop: 14 }}>
                <label style={ui.label} htmlFor="cleaner">Cleaner</label>
                <select
                  id="cleaner"
                  style={{ ...ui.input, background: '#0b1220', cursor: 'pointer' }}
                  value={selectedCleanerId}
                  onChange={e => setSelectedCleanerId(e.target.value)}
                >
                  {cleaners.map(c => (
                    <option key={c.id} value={c.id}>
                      {c.name}{c.phone ? ` — ${c.phone}` : ''}
                    </option>
                  ))}
                </select>

                <label style={{ ...ui.label, marginTop: 10 }} htmlFor="notes">Notes (optional)</label>
                <textarea
                  id="notes"
                  rows={3}
                  placeholder="Any details for this turn…"
                  style={{ ...ui.input, padding: '12px 14px', resize: 'vertical' }}
                  value={notes}
                  onChange={e => setNotes(e.target.value)}
                />

                <div style={{ ...ui.row, marginTop: 12 }}>
                  <button type="submit" disabled={starting} style={ui.btnPrimary}>
                    {starting ? 'Starting…' : 'Start turn & send link'}
                  </button>
                  <button type="button" onClick={() => router.push('/dashboard')} style={ui.btnSecondary}>
                    Dashboard
                  </button>
                </div>
              </form>

              {msg && (
                <div style={{ marginTop: 10, color: msg.includes('✅') ? '#22c55e' : '#fca5a5' }}>
                  {msg}
                </div>
              )}

              {links?.turn_id && (
                <div style={{ marginTop: 12 }}>
                  <div style={ui.subtle}>
                    Turn ID: <code style={{ userSelect: 'all' }}>{links.turn_id}</code>
                  </div>
                  {links?.capture_url && (
                    <div style={{ marginTop: 8 }}>
                      <a href={links.capture_url} target="_blank" rel="noreferrer" style={ui.btnSecondary}>
                        Open capture link
                      </a>
                    </div>
                  )}
                  {typeof links?.sms === 'string' && (
                    <div style={{ ...ui.subtle, marginTop: 8 }}>
                      SMS: <b>{links.sms}</b>
                    </div>
                  )}
                </div>
              )}
            </>
          )}
        </div>

        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Need a checklist?</h2>
          <div style={ui.row}>
            <button onClick={() => router.push(`/properties/${property.id}/template`)} style={ui.btnSecondary}>
              Build checklist
            </button>
            <button onClick={() => router.push(`/managers/turns`)} style={ui.btnSecondary}>
              Review turns
            </button>
          </div>
        </div>
      </section>
    </ChromeDark>
  );
}
