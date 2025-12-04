// pages/properties/[id]/template.js
import { useEffect, useState, useRef, Fragment } from 'react';
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

  // thumbnail cache for reference photos
  const [thumbByPath, setThumbByPath] = useState({});
  const requestedThumbsRef = useRef(new Set());

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

        // 3) Load template shots (including reference_paths)
        const { data: s, error: sErr } = await supabase
          .from('template_shots')
          .select('id, template_id, label, min_count, area_key, reference_paths, created_at')
          .eq('template_id', tpl.id)
          .order('created_at', { ascending: true });
        if (sErr) throw sErr;
        setShots(s || []);
        setMsg('');
      } catch (e) {
        setMsg(e.message || 'Failed to load template');
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  async function addShot(e) {
    e?.preventDefault?.();
    try {
      setMsg('');
      const label = newLabel.trim();
      const required = Math.max(1, parseInt(newRequired || 1, 10));
      if (!template?.id) throw new Error('Template not ready.');
      if (!label) throw new Error('Enter a label for the checklist item.');

      const { data: created, error } = await supabase
        .from('template_shots')
        .insert({
          template_id: template.id,
          label,
          area_key: newArea,
          min_count: required,
          // reference_paths will default to NULL / empty
        })
        .select('id, template_id, label, min_count, area_key, reference_paths, created_at')
        .single();
      if (error) throw error;

      setShots(prev => [...prev, created]);
      setNewLabel('');
      setNewArea('general');
      setNewRequired(1);
      setMsg('Added.');
      setTimeout(() => setMsg(''), 1200);
    } catch (e) {
      setMsg(e.message || 'Could not add item');
    }
  }

  async function updateLabel(id, label) {
    try {
      setShots(prev => prev.map(s => s.id === id ? { ...s, label } : s));
      const { error } = await supabase.from('template_shots').update({ label }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      setMsg(e.message || 'Update failed');
    }
  }

  async function updateArea(id, area_key) {
    try {
      setShots(prev => prev.map(s => s.id === id ? { ...s, area_key } : s));
      const { error } = await supabase.from('template_shots').update({ area_key }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      setMsg(e.message || 'Update failed');
    }
  }

  async function updateRequired(id, val) {
    const required = Math.max(1, parseInt(val || 1, 10));
    try {
      setShots(prev => prev.map(s => s.id === id ? { ...s, min_count: required } : s));
      const { error } = await supabase.from('template_shots').update({ min_count: required }).eq('id', id);
      if (error) throw error;
    } catch (e) {
      setMsg(e.message || 'Update failed');
    }
  }

  async function deleteShot(id) {
    try {
      setShots(prev => prev.filter(s => s.id !== id));
      const { error } = await supabase.from('template_shots').delete().eq('id', id);
      if (error) throw error;
    } catch (e) {
      setMsg(e.message || 'Delete failed');
    }
  }

  // --- sign-photo helper (same idea as cleaner side) ---
  async function signPath(path) {
    const resp = await fetch('/api/sign-photo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ path, expires: 600 })
    });
    if (!resp.ok) throw new Error('sign failed');
    const json = await resp.json();
    return json.url;
  }

  function ensureThumb(path) {
    if (!path || requestedThumbsRef.current.has(path) || thumbByPath[path]) return;
    requestedThumbsRef.current.add(path);
    signPath(path)
      .then(url => {
        if (url) {
          setThumbByPath(prev =>
            prev[path] ? prev : { ...prev, [path]: url }
          );
        }
      })
      .catch(() => {
        requestedThumbsRef.current.delete(path);
      });
  }

  async function openSigned(path) {
    try {
      const popup = typeof window !== 'undefined' ? window.open('', '_blank') : null;
      const url = await signPath(path);
      if (!popup) {
        window.location.href = url;
      } else {
        popup.location.href = url;
      }
    } catch (e) {
      console.error('openSigned error:', e);
    }
  }

  // --- add a reference photo for a specific shot ---
  async function handleRefFileChange(shot, event) {
    const file = event.target.files?.[0];
    if (!file) return;

    try {
      setMsg('');

      // Build a stable-ish safe filename
      const safeName = file.name.replace(/[^\w.\-]/g, '_');
      const path = `refs/${shot.id}/${Date.now()}-${safeName}`;

      // 1) upload to photos bucket
      const { error: uploadErr } = await supabase
        .storage
        .from('photos')
        .upload(path, file, {
          cacheControl: '3600',
          upsert: false,
        });
      if (uploadErr) throw uploadErr;

      // 2) append to reference_paths in DB
      const existing = Array.isArray(shot.reference_paths) ? shot.reference_paths : [];
      const nextRefs = [...existing, path];

      const { error: dbErr } = await supabase
        .from('template_shots')
        .update({ reference_paths: nextRefs })
        .eq('id', shot.id);
      if (dbErr) throw dbErr;

      // 3) update local state so UI reflects new set
      setShots(prev =>
        prev.map(s => (s.id === shot.id ? { ...s, reference_paths: nextRefs } : s))
      );

      setMsg('Reference photo added.');
      setTimeout(() => setMsg(''), 1200);
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Failed to add reference photo');
    } finally {
      // allow re-selecting the same file again
      if (event?.target) {
        event.target.value = '';
      }
    }
  }

  // --- delete a single reference photo for a shot ---
  async function deleteReferencePath(shot, pathToRemove) {
    try {
      const existing = Array.isArray(shot.reference_paths) ? shot.reference_paths : [];
      const nextRefs = existing.filter(p => p !== pathToRemove);

      const { error: dbErr } = await supabase
        .from('template_shots')
        .update({ reference_paths: nextRefs })
        .eq('id', shot.id);
      if (dbErr) throw dbErr;

      setShots(prev =>
        prev.map(s => (s.id === shot.id ? { ...s, reference_paths: nextRefs } : s))
      );
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
            <div style={{ marginTop: 10, color: msg.match(/Added|Saved|Updated/i) ? '#22c55e' : '#fca5a5' }}>
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
                    <th style={{ padding:'10px 8px' }}>Label</th>
                    <th style={{ padding:'10px 8px' }}>Area</th>
                    <th style={{ padding:'10px 8px', width:120 }}>Required</th>
                    <th style={{ padding:'10px 8px', width:220 }}>Reference photos</th>
                    <th style={{ padding:'10px 8px', width:120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {shots.map(shot => {
                    const refPaths = Array.isArray(shot.reference_paths) ? shot.reference_paths : [];
                    const refCount = refPaths.length;

                    return (
                      <Fragment key={shot.id}>
                        {/* Row for thumbnails ABOVE the actual checklist row */}
                        {refCount > 0 && (
                          <tr>
                            <td colSpan={5} style={{ padding:'6px 8px 2px' }}>
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                  padding: 6,
                                  borderRadius: 8,
                                  border: '1px solid #1f2937',
                                  background: '#020617'
                                }}
                              >
                                {refPaths.map(path => {
                                  if (!thumbByPath[path]) ensureThumb(path);
                                  const thumb = thumbByPath[path] || null;

                                  return (
                                    <div
                                      key={path}
                                      style={{
                                        position:'relative',
                                        width:70,
                                        height:70,
                                        borderRadius:8,
                                        overflow:'hidden',
                                        border:'1px solid #334155',
                                        background:'#0f172a',
                                        cursor:'pointer'
                                      }}
                                      onClick={() => openSigned(path)}
                                    >
                                      {thumb ? (
                                        <img
                                          src={thumb}
                                          alt="Reference"
                                          style={{
                                            width:'100%',
                                            height:'100%',
                                            objectFit:'cover'
                                          }}
                                        />
                                      ) : null}

                                      {/* red X delete button */}
                                      <button
                                        type="button"
                                        onClick={(e) => {
                                          e.stopPropagation();
                                          deleteReferencePath(shot, path);
                                        }}
                                        style={{
                                          position:'absolute',
                                          top:2,
                                          right:2,
                                          width:18,
                                          height:18,
                                          borderRadius:'999px',
                                          border:'none',
                                          background:'#b91c1c',
                                          color:'#fee2e2',
                                          fontSize:11,
                                          fontWeight:700,
                                          display:'flex',
                                          alignItems:'center',
                                          justifyContent:'center',
                                          cursor:'pointer',
                                          boxShadow:'0 0 0 1px rgba(0,0,0,0.5)'
                                        }}
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </td>
                          </tr>
                        )}

                        {/* Main checklist row */}
                        <tr style={{ borderBottom:'1px solid #111827' }}>
                          <td style={{ padding:'10px 8px' }}>
                            <input
                              type="text"
                              value={shot.label || ''}
                              onChange={e => updateLabel(shot.id, e.target.value)}
                              style={{ ...ui.input }}
                            />
                          </td>
                          <td style={{ padding:'10px 8px' }}>
                            <select
                              value={shot.area_key || 'general'}
                              onChange={e => updateArea(shot.id, e.target.value)}
                              style={{ ...ui.input, background: '#0b1220', cursor:'pointer' }}
                            >
                              {AREAS.map(([v, label]) => (
                                <option key={v} value={v}>{label}</option>
                              ))}
                            </select>
                          </td>
                          <td style={{ padding:'10px 8px' }}>
                            <input
                              type="number"
                              min={1}
                              step={1}
                              value={shot.min_count || 1}
                              onChange={e => updateRequired(shot.id, e.target.value)}
                              style={{ ...ui.input }}
                            />
                          </td>

                          {/* Reference photo column */}
                          <td style={{ padding:'10px 8px' }}>
                            {/* hidden input for this shot */}
                            <input
                              type="file"
                              accept="image/*"
                              style={{ display:'none' }}
                              ref={el => { refInputs.current[shot.id] = el; }}
                              onChange={e => handleRefFileChange(shot, e)}
                            />
                            <div style={{ display:'flex', flexDirection:'column', gap:4 }}>
                              <div style={{ fontSize:12, color:'#9ca3af' }}>
                                {refCount === 0 && 'No reference photos yet'}
                                {refCount === 1 && '1 reference photo'}
                                {refCount > 1 && `${refCount} reference photos`}
                              </div>
                              <button
                                type="button"
                                style={ui.btnSecondary}
                                onClick={() => refInputs.current[shot.id]?.click()}
                              >
                                + Add reference photo
                              </button>
                            </div>
                          </td>

                          <td style={{ padding:'10px 8px' }}>
                            <button onClick={() => deleteShot(shot.id)} style={ui.btnSecondary}>
                              Delete
                            </button>
                          </td>
                        </tr>
                      </Fragment>
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
