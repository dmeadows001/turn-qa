// pages/properties/[id]/template.js
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

const supabase = supabaseBrowser();

// Opinionated areas; tweak as needed
const AREAS = [
  ['general', 'General'],
  ['kitchen', 'Kitchen'],
  ['bathroom', 'Bathroom'],
  ['bedroom', 'Bedroom'],
  ['living_room', 'Living room'],
  ['laundry', 'Laundry'],
  ['exterior', 'Exterior'],
  ['other', 'Other'],
];

export default function TemplateBuilder() {
  const router = useRouter();
  const { id: propertyId } = router.query;

  const [loading, setLoading]   = useState(true);
  const [msg, setMsg]           = useState('');
  const [property, setProperty] = useState(null);
  const [template, setTemplate] = useState(null);
  const [shots, setShots]       = useState([]);
  const [newLabel, setNewLabel] = useState('');
  const [newArea, setNewArea]   = useState('general');
  const [newRequired, setNewRequired] = useState(1);

  // one hidden file input per shot for reference uploads
  const refInputs = useRef({});

  // NEW: drag state
  const [draggingId, setDraggingId] = useState(null);

  useEffect(() => {
    if (!propertyId) return;
    (async () => {
      try {
        setLoading(true);
        setMsg('Loading…');

        // 1) Load property
        const { data: prop, error: pErr } = await supabase
          .from('properties')
          .select('id, name')
          .eq('id', propertyId)
          .single();
        if (pErr) throw pErr;
        setProperty(prop);

        // 2) Ensure a template exists for this property
        let { data: tpl, error: tErr } = await supabase
          .from('property_templates')
          .select('id, property_id, name')
          .eq('property_id', propertyId)
          .limit(1)
          .maybeSingle();
        if (tErr) throw tErr;

        if (!tpl) {
          const { data: created, error: cErr } = await supabase
            .from('property_templates')
            .insert({ property_id: propertyId, name: 'Default' })
            .select('id, property_id, name')
            .single();
          if (cErr) throw cErr;
          tpl = created;
        }
        setTemplate(tpl);

        // 3) Load template shots (NOW including reference_paths + sort_index)
        const { data: s, error: sErr } = await supabase
          .from('template_shots')
          .select('id, template_id, label, min_count, area_key, reference_paths, created_at, sort_index')
          .eq('template_id', tpl.id)
          .order('sort_index', { ascending: true, nullsFirst: true })
          .order('created_at', { ascending: true });
        if (sErr) throw sErr;

        const ordered = (s || []).map((shot, idx) => ({
          ...shot,
          // normalize sort_index locally; if null, fallback to row index
          sort_index: typeof shot.sort_index === 'number' ? shot.sort_index : idx,
          reference_paths: Array.isArray(shot.reference_paths) ? shot.reference_paths : [],
        }));

        setShots(ordered);
        setMsg('');
      } catch (e) {
        console.error(e);
        setMsg(e.message || 'Failed to load template');
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  // --- helper: persist order to DB ---
  async function persistSortOrder(nextShots) {
    try {
      // Build updates { id, sort_index }
      const updates = nextShots.map((s, idx) => ({
        id: s.id,
        sort_index: idx,
      }));

      const { error } = await supabase
        .from('template_shots')
        .upsert(updates, { onConflict: 'id' });

      if (error) throw error;
      setMsg('Order saved.');
      setTimeout(() => setMsg(''), 1000);
    } catch (e) {
      console.error('Reorder failed:', e);
      setMsg(
        e.message ||
        'Reorder failed. If you see a "column sort_index" error, add that column to template_shots.'
      );
    }
  }

  // --- drag handlers ---
  function handleDragStart(id) {
    setDraggingId(id);
  }

  function handleDragEnd() {
    setDraggingId(null);
  }

  function handleRowDrop(targetId) {
    if (!draggingId || draggingId === targetId) return;

    setShots(prev => {
      const list = [...prev];
      const fromIndex = list.findIndex(s => s.id === draggingId);
      const toIndex   = list.findIndex(s => s.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);

      const withIndex = list.map((s, idx) => ({ ...s, sort_index: idx }));
      // fire-and-forget persist
      persistSortOrder(withIndex);
      return withIndex;
    });

    setDraggingId(null);
  }

  async function addShot(e) {
    e?.preventDefault?.();
    try {
      setMsg('');
      const label = newLabel.trim();
      const required = Math.max(1, parseInt(newRequired || 1, 10));
      if (!template?.id) throw new Error('Template not ready.');
      if (!label) throw new Error('Enter a label for the checklist item.');

      const currentMaxIndex = shots.length
        ? Math.max(...shots.map(s => (typeof s.sort_index === 'number' ? s.sort_index : 0)))
        : 0;
      const nextIndex = currentMaxIndex + 1;

      const { data: created, error } = await supabase
        .from('template_shots')
        .insert({
          template_id: template.id,
          label,
          area_key: newArea,
          min_count: required,
          sort_index: nextIndex,
          // reference_paths will default to NULL / empty
        })
        .select('id, template_id, label, min_count, area_key, reference_paths, created_at, sort_index')
        .single();
      if (error) throw error;

      const normalized = {
        ...created,
        sort_index: typeof created.sort_index === 'number' ? created.sort_index : nextIndex,
        reference_paths: Array.isArray(created.reference_paths)
          ? created.reference_paths
          : [],
      };

      setShots(prev => [...prev, normalized].sort((a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0)));
      setNewLabel('');
      setNewArea('general');
      setNewRequired(1);
      setMsg('Added.');
      setTimeout(() => setMsg(''), 1200);
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Could not add item');
    }
  }

  async function updateLabel(id, label) {
    try {
      setShots(prev => prev.map(s => (s.id === id ? { ...s, label } : s)));
      const { error } = await supabase.from('template_shots').update({ label }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Update failed');
    }
  }

  async function updateArea(id, area_key) {
    try {
      setShots(prev => prev.map(s => (s.id === id ? { ...s, area_key } : s)));
      const { error } = await supabase.from('template_shots').update({ area_key }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Update failed');
    }
  }

  async function updateRequired(id, val) {
    const required = Math.max(1, parseInt(val || 1, 10));
    try {
      setShots(prev => prev.map(s => (s.id === id ? { ...s, min_count: required } : s)));
      const { error } = await supabase.from('template_shots').update({ min_count: required }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Update failed');
    }
  }

  async function deleteShot(id) {
    try {
      setShots(prev => prev.filter(s => s.id !== id));
      const { error } = await supabase.from('template_shots').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Delete failed');
    }
  }

  // --- reference photos: add ---
  async function handleRefFileChange(shot, event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setMsg('');

      const safeName = file.name.replace(/[^\w.\-]/g, '_');
      const path = `refs/${shot.id}/${Date.now()}-${safeName}`;

      const { error: uploadErr } = await supabase
        .storage
        .from('photos')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      const existing = Array.isArray(shot.reference_paths) ? shot.reference_paths : [];
      const nextRefs = [...existing, path];

      const { error: dbErr } = await supabase
        .from('template_shots')
        .update({ reference_paths: nextRefs })
        .eq('id', shot.id);
      if (dbErr) throw dbErr;

      setShots(prev =>
        prev.map(s => (s.id === shot.id ? { ...s, reference_paths: nextRefs } : s))
      );

      setMsg('Reference photo added.');
      setTimeout(() => setMsg(''), 1200);
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Failed to add reference photo');
    } finally {
      if (event?.target) {
        event.target.value = '';
      }
    }
  }

  // --- reference photos: delete a single ref path ---
  async function handleDeleteRefPhoto(shotId, pathToRemove) {
    try {
      const shot = shots.find(s => s.id === shotId);
      if (!shot) return;

      const existing = Array.isArray(shot.reference_paths) ? shot.reference_paths : [];
      const nextRefs = existing.filter(p => p !== pathToRemove);

      setShots(prev =>
        prev.map(s =>
          s.id === shotId ? { ...s, reference_paths: nextRefs } : s
        )
      );

      const { error } = await supabase
        .from('template_shots')
        .update({ reference_paths: nextRefs })
        .eq('id', shotId);
      if (error) throw error;

      // Optional: delete from storage too (non-fatal if it fails)
      try {
        await supabase.storage.from('photos').remove([pathToRemove]);
      } catch {
        // ignore
      }
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Failed to delete reference photo');
    }
  }

  // -------------- Render --------------
  if (loading) {
    return (
      <ChromeDark title="Property">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>Loading…</div>
        </section>
      </ChromeDark>
    );
  }

  if (!property || !template) {
    return (
      <ChromeDark title="Property">
        <section style={ui.sectionGrid}>
          <div style={ui.card}>
            Could not load this property/template.
          </div>
        </section>
      </ChromeDark>
    );
  }

  return (
    <ChromeDark title={property.name}>
      <section style={ui.sectionGrid}>
        {/* Builder */}
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>
            Checklist for <span style={{ color: '#cbd5e1' }}>{property.name}</span>
          </h2>
          <div style={ui.subtle}>Define the photos your cleaner must capture per area.</div>

          {/* Add new item */}
          <form onSubmit={addShot} style={{ marginTop: 14 }}>
            <label style={ui.label}>Add checklist item</label>
            <div style={{ ...ui.row }}>
              <input
                type="text"
                placeholder="e.g., Kitchen — Overall"
                style={{ ...ui.input, flex: 2, minWidth: 240 }}
                value={newLabel}
                onChange={e => setNewLabel(e.target.value)}
              />
              <select
                style={{ ...ui.input, flex: 1, minWidth: 160, background: '#0b1220', cursor:'pointer' }}
                value={newArea}
                onChange={e => setNewArea(e.target.value)}
              >
                {AREAS.map(([v, label]) => (
                  <option key={v} value={v}>{label}</option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                step={1}
                style={{ ...ui.input, width: 120 }}
                value={newRequired}
                onChange={e => setNewRequired(e.target.value)}
              />
              <button type="submit" style={ui.btnPrimary}>Add</button>
            </div>
            <div style={{ ...ui.subtle, marginTop: 6 }}>
              “Required” = minimum number of photos for this item.
            </div>
          </form>

          {msg && (
            <div style={{ marginTop: 10, color: msg.match(/Added|Saved|Updated|Order saved/i) ? '#22c55e' : '#fca5a5' }}>
              {msg}
            </div>
          )}

          {/* Existing items */}
          <div style={{ marginTop: 18, overflowX:'auto' }}>
            {shots.length === 0 ? (
              <div style={ui.muted}>No items yet — add your first checklist item above.</div>
            ) : (
              <table style={{ width:'100%', minWidth: 900, borderCollapse:'collapse' }}>
                <thead>
                  <tr style={{ textAlign:'left', borderBottom:'1px solid #1f2937' }}>
                    <th style={{ padding:'10px 8px', width:32 }}></th> {/* drag handle */}
                    <th style={{ padding:'10px 8px' }}>Label</th>
                    <th style={{ padding:'10px 8px' }}>Area</th>
                    <th style={{ padding:'10px 8px', width:120 }}>Required</th>
                    <th style={{ padding:'10px 8px', width:260 }}>Reference photos</th>
                    <th style={{ padding:'10px 8px', width:120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {shots.map(s => {
                    const refCount = Array.isArray(s.reference_paths) ? s.reference_paths.length : 0;
                    const isDragging = draggingId === s.id;

                    return (
                      <tr
                        key={s.id}
                        draggable
                        onDragStart={() => handleDragStart(s.id)}
                        onDragOver={e => e.preventDefault()}
                        onDrop={() => handleRowDrop(s.id)}
                        onDragEnd={handleDragEnd}
                        style={{
                          borderBottom:'1px solid #111827',
                          background: isDragging ? '#020617' : 'transparent',
                          opacity: isDragging ? 0.85 : 1,
                        }}
                      >
                        {/* drag handle */}
                        <td style={{ padding:'10px 8px', cursor:'grab', verticalAlign:'top' }}>
                          <span style={{ fontSize:16, color:'#6b7280' }}>⋮⋮</span>
                        </td>

                        <td style={{ padding:'10px 8px', verticalAlign:'top' }}>
                          <input
                            type="text"
                            value={s.label || ''}
                            onChange={e => updateLabel(s.id, e.target.value)}
                            style={{ ...ui.input }}
                          />
                        </td>

                        <td style={{ padding:'10px 8px', verticalAlign:'top' }}>
                          <select
                            value={s.area_key || 'general'}
                            onChange={e => updateArea(s.id, e.target.value)}
                            style={{ ...ui.input, background: '#0b1220', cursor:'pointer' }}
                          >
                            {AREAS.map(([v, label]) => (
                              <option key={v} value={v}>{label}</option>
                            ))}
                          </select>
                        </td>

                        <td style={{ padding:'10px 8px', verticalAlign:'top' }}>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={s.min_count || 1}
                            onChange={e => updateRequired(s.id, e.target.value)}
                            style={{ ...ui.input }}
                          />
                        </td>

                        {/* Reference photos: thumbnails above + add button */}
                        <td style={{ padding:'10px 8px', verticalAlign:'top' }}>
                          {/* hidden input for this shot */}
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display:'none' }}
                            ref={el => { refInputs.current[s.id] = el; }}
                            onChange={e => handleRefFileChange(s, e)}
                          />

                          {/* thumbnail strip */}
                          {refCount > 0 && (
                            <div style={{ display:'flex', flexWrap:'wrap', gap:8, marginBottom:6 }}>
                              {s.reference_paths.map(path => (
                                <div
                                  key={path}
                                  style={{
                                    position:'relative',
                                    width:64,
                                    height:64,
                                    borderRadius:8,
                                    overflow:'hidden',
                                    border:'1px solid #374151',
                                    background:'#020617',
                                  }}
                                >
                                  {/* We don't sign here; capture.js will sign when cleaners view.
                                      For manager, we can show object path as text-free placeholder. */}
                                  <div
                                    style={{
                                      width:'100%',
                                      height:'100%',
                                      backgroundImage: 'linear-gradient(135deg,#1f2937,#020617)',
                                      display:'flex',
                                      alignItems:'center',
                                      justifyContent:'center',
                                      fontSize:10,
                                      color:'#9ca3af',
                                      textAlign:'center',
                                      padding:4,
                                    }}
                                  >
                                    Ref
                                  </div>
                                  <button
                                    type="button"
                                    onClick={() => handleDeleteRefPhoto(s.id, path)}
                                    style={{
                                      position:'absolute',
                                      top:2,
                                      right:2,
                                      width:18,
                                      height:18,
                                      borderRadius:'999px',
                                      border:'none',
                                      background:'#7f1d1d',
                                      color:'#fee2e2',
                                      fontSize:11,
                                      cursor:'pointer',
                                      display:'flex',
                                      alignItems:'center',
                                      justifyContent:'center',
                                    }}
                                    title="Delete reference photo"
                                  >
                                    ✕
                                  </button>
                                </div>
                              ))}
                            </div>
                          )}

                          <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                            <div style={{ fontSize:12, color:'#9ca3af' }}>
                              {refCount === 0 && 'No reference photos yet'}
                              {refCount === 1 && '1 reference photo'}
                              {refCount > 1 && `${refCount} reference photos`}
                            </div>
                            <button
                              type="button"
                              style={ui.btnSecondary}
                              onClick={() => refInputs.current[s.id]?.click()}
                            >
                              + Add reference photo
                            </button>
                          </div>
                        </td>

                        <td style={{ padding:'10px 8px', verticalAlign:'top' }}>
                          <button onClick={() => deleteShot(s.id)} style={ui.btnSecondary}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Actions / Next steps */}
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 8 }}>Next steps</h2>
          <div style={{ ...ui.row }}>
            <button
              onClick={() => router.push(`/properties/${property.id}/invite`)}
              style={ui.btnPrimary}
            >
              Invite cleaner
            </button>
            <button
              onClick={() => router.push(`/properties/${property.id}/start-turn`)}
              style={ui.btnSecondary}
            >
              Start a test turn
            </button>
            <button
              onClick={() => router.push('/dashboard')}
              style={ui.btnSecondary}
            >
              Back to dashboard
            </button>
          </div>
          <div style={{ ...ui.subtle, marginTop: 10 }}>
            When a cleaner submits a turn, you’ll review it under <b>Manager → Turns</b>.
          </div>
        </div>
      </section>
    </ChromeDark>
  );
}
