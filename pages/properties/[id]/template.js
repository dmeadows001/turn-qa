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

function GettingStartedModal({ storageKey, title, children, open, setOpen }) {
  const [dontShow, setDontShow] = useState(false);

  function safeGetLS(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function safeSetLS(key, val) {
    try { window.localStorage.setItem(key, val); } catch {}
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seen = safeGetLS(storageKey);
      if (!seen) setOpen(true);
    } catch {
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function dismiss(persist = true) {
    // persist only if caller wants to AND checkbox checked
    if (persist && dontShow) safeSetLS(storageKey, '1');
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
      onClick={() => {
        // click outside closes (same as dismiss, but doesn't persist unless checkbox checked)
        dismiss(false);
      }}
    >
      <div
        style={{ ...ui.card, maxWidth: 780, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div>
            <h2 style={{ margin: 0 }}>Getting Started</h2>
            <div style={{ ...ui.subtle, marginTop: 6 }}>{title}</div>
          </div>
          <button
            type="button"
            onClick={() => dismiss(true)}
            style={ui.btnSecondary}
            aria-label="Dismiss"
          >
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

          <button
            type="button"
            onClick={() => dismiss(true)}
            style={ui.btnPrimary}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

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

  // ✅ Getting Started (Help) state
  const [showGettingStarted, setShowGettingStarted] = useState(false);

  function openGettingStarted() {
    setShowGettingStarted(true);
  }

  // one hidden file input per shot for reference uploads
  const refInputs = useRef({});

  // drag state
  const [draggingId, setDraggingId] = useState(null);

  // thumbnail signing cache (for reference photos)
  const [thumbByPath, setThumbByPath] = useState({});
  const requestedThumbsRef = useRef(new Set());

  // ✅ Cache auth token briefly to avoid calling getSession repeatedly during thumb signing
  const authTokenRef = useRef({ token: null, fetchedAt: 0 });

  async function getAccessToken() {
    const now = Date.now();
    if (authTokenRef.current.token && (now - authTokenRef.current.fetchedAt) < 30_000) {
      return authTokenRef.current.token;
    }
    const { data } = await supabase.auth.getSession();
    const token = data?.session?.access_token || null;
    authTokenRef.current = { token, fetchedAt: now };
    return token;
  }

  async function signPath(path) {
    const token = await getAccessToken();
    if (!token) throw new Error('Not signed in (missing session). Please refresh and log in again.');

    const resp = await fetch('/api/sign-photo', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ path, expires: 600 }),
    });

    if (!resp.ok) {
      let detail = '';
      try {
        const j = await resp.json();
        detail = j?.error ? ` (${j.error})` : '';
      } catch {}
      throw new Error(`sign failed${detail}`);
    }

    const json = await resp.json();
    return json.url;
  }

  // Open a signed URL in a way that works on mobile (Safari popup rules)
  async function openSignedPath(path) {
    try {
      const win = window.open('', '_blank');
      if (!win) {
        const url = await signPath(path);
        if (url) window.location.href = url;
        return;
      }
      const url = await signPath(path);
      if (!url) {
        win.close();
        return;
      }
      win.location = url;
    } catch (e) {
      console.error('openSignedPath error:', e);
    }
  }

  function ensureThumb(path) {
    if (!path || requestedThumbsRef.current.has(path) || thumbByPath[path]) return;
    requestedThumbsRef.current.add(path);
    signPath(path)
      .then((url) => {
        if (!url) return;
        setThumbByPath((prev) =>
          prev[path] ? prev : { ...prev, [path]: url }
        );
      })
      .catch(() => {
        requestedThumbsRef.current.delete(path);
      });
  }

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

        // 3) Load template shots
        const { data: s, error: sErr } = await supabase
          .from('template_shots')
          .select(
            'id, template_id, label, min_count, area_key, reference_paths, created_at, sort_index'
          )
          .eq('template_id', tpl.id)
          .order('sort_index', { ascending: true, nullsFirst: true })
          .order('created_at', { ascending: true });
        if (sErr) throw sErr;

        const ordered = (s || []).map((shot, idx) => ({
          ...shot,
          sort_index:
            typeof shot.sort_index === 'number' ? shot.sort_index : idx,
          reference_paths: Array.isArray(shot.reference_paths)
            ? shot.reference_paths
            : [],
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

  // persist order (UPDATE only → RLS-friendly)
  async function persistSortOrder(nextShots) {
    try {
      for (const s of nextShots) {
        const { error } = await supabase
          .from('template_shots')
          .update({ sort_index: s.sort_index })
          .eq('id', s.id);
        if (error) throw error;
      }
      setMsg('Order saved.');
      setTimeout(() => setMsg(''), 1000);
    } catch (e) {
      console.error('Reorder failed:', e);
      setMsg(e.message || 'Reorder failed.');
    }
  }

  // drag handlers (desktop)
  function handleDragStart(id) {
    setDraggingId(id);
  }

  function handleDragEnd() {
    setDraggingId(null);
  }

  function handleRowDrop(targetId) {
    if (!draggingId || draggingId === targetId) return;

    setShots((prev) => {
      const list = [...prev];
      const fromIndex = list.findIndex((s) => s.id === draggingId);
      const toIndex = list.findIndex((s) => s.id === targetId);
      if (fromIndex === -1 || toIndex === -1) return prev;

      const [moved] = list.splice(fromIndex, 1);
      list.splice(toIndex, 0, moved);

      const withIndex = list.map((s, idx) => ({ ...s, sort_index: idx }));
      persistSortOrder(withIndex);
      return withIndex;
    });

    setDraggingId(null);
  }

  // tap-based move for mobile (Up / Down buttons)
  function moveShot(id, delta) {
    setShots((prev) => {
      const list = [...prev];
      const idx = list.findIndex((s) => s.id === id);
      if (idx === -1) return prev;
      const target = idx + delta;
      if (target < 0 || target >= list.length) return prev;

      const [item] = list.splice(idx, 1);
      list.splice(target, 0, item);

      const withIndex = list.map((s, i) => ({ ...s, sort_index: i }));
      persistSortOrder(withIndex);
      return withIndex;
    });
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
        ? Math.max(
            ...shots.map((s) =>
              typeof s.sort_index === 'number' ? s.sort_index : 0
            )
          )
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
        })
        .select(
          'id, template_id, label, min_count, area_key, reference_paths, created_at, sort_index'
        )
        .single();
      if (error) throw error;

      const normalized = {
        ...created,
        sort_index:
          typeof created.sort_index === 'number'
            ? created.sort_index
            : nextIndex,
        reference_paths: Array.isArray(created.reference_paths)
          ? created.reference_paths
          : [],
      };

      setShots((prev) =>
        [...prev, normalized].sort(
          (a, b) => (a.sort_index ?? 0) - (b.sort_index ?? 0)
        )
      );
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
      setShots((prev) => prev.map((s) => (s.id === id ? { ...s, label } : s)));
      const { error } = await supabase
        .from('template_shots')
        .update({ label })
        .eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Update failed');
    }
  }

  async function updateArea(id, area_key) {
    try {
      setShots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, area_key } : s))
      );
      const { error } = await supabase
        .from('template_shots')
        .update({ area_key })
        .eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Update failed');
    }
  }

  async function updateRequired(id, val) {
    const required = Math.max(1, parseInt(val || 1, 10));
    try {
      setShots((prev) =>
        prev.map((s) => (s.id === id ? { ...s, min_count: required } : s))
      );
      const { error } = await supabase
        .from('template_shots')
        .update({ min_count: required })
        .eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Update failed');
    }
  }

  async function deleteShot(id) {
    try {
      setShots((prev) => prev.filter((s) => s.id !== id));
      const { error } = await supabase
        .from('template_shots')
        .delete()
        .eq('id', id);
      if (error) throw error;
    } catch (e) {
      console.error(e);
      setMsg(e.message || 'Delete failed');
    }
  }

  // reference photos: add
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

      const existing = Array.isArray(shot.reference_paths)
        ? shot.reference_paths
        : [];
      const nextRefs = [...existing, path];

      const { error: dbErr } = await supabase
        .from('template_shots')
        .update({ reference_paths: nextRefs })
        .eq('id', shot.id);
      if (dbErr) throw dbErr;

      setShots((prev) =>
        prev.map((s) => (s.id === shot.id ? { ...s, reference_paths: nextRefs } : s))
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

  // reference photos: delete single
  async function handleDeleteRefPhoto(shotId, pathToRemove) {
    try {
      const shot = shots.find((s) => s.id === shotId);
      if (!shot) return;

      const existing = Array.isArray(shot.reference_paths)
        ? shot.reference_paths
        : [];
      const nextRefs = existing.filter((p) => p !== pathToRemove);

      setShots((prev) =>
        prev.map((s) =>
          s.id === shotId ? { ...s, reference_paths: nextRefs } : s
        )
      );

      const { error } = await supabase
        .from('template_shots')
        .update({ reference_paths: nextRefs })
        .eq('id', shotId);
      if (error) throw error;

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
      <GettingStartedModal
        storageKey="turnqa_gs_manager_template_v1"
        title="Build your TurnQA checklist (Sections + Photo Requests)"
        open={showGettingStarted}
        setOpen={setShowGettingStarted}
      >
        <div style={{ marginBottom: 10 }}>
          To get started, choose an area (like <b>Kitchen</b>) and enter what photo you want, like
          “Overall kitchen shot” or “Photo of refrigerator”.
        </div>
        <div style={{ marginBottom: 10 }}>
          Add as many shots as you need for that area, then move on to the next area (Master Bedroom, Bathroom, etc.).
        </div>
        <div style={ui.subtle}>
          Tip: Use “Required” to enforce multiple angles (example: “Bathroom — Shower” required = 2).
        </div>
      </GettingStartedModal>

      <section style={ui.sectionGrid}>
        {/* Builder */}
        <div style={ui.card}>
          <div style={{ position: 'relative', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <h2 style={{ marginTop: 0, marginBottom: 8 }}>
              Checklist for <span style={{ color: '#cbd5e1' }}>{property.name}</span>
            </h2>

            <button
              type="button"
              onClick={openGettingStarted}
              style={{
                position: 'absolute',
                right: 0,
                top: '50%',
                transform: 'translateY(-50%)',
                ...ui.btnSecondary,
                padding: '6px 10px',
                borderRadius: 999,
                border: '1px solid #334155',
                background: '#0f172a',
                color: '#cbd5e1',
              }}
              title="Help / Getting Started"
              aria-label="Help / Getting Started"
            >
              ❓ Help
            </button>
          </div>

          <div style={ui.subtle}>
            Define the photos your cleaner must capture per area.
          </div>

          {/* Add new item */}
          <form onSubmit={addShot} style={{ marginTop: 14 }}>
            <label style={ui.label}>Add checklist item</label>
            <div style={{ ...ui.row }}>
              <input
                type="text"
                placeholder="e.g., Kitchen — Overall"
                style={{ ...ui.input, flex: 2, minWidth: 240 }}
                value={newLabel}
                onChange={(e) => setNewLabel(e.target.value)}
              />
              <select
                style={{
                  ...ui.input,
                  flex: 1,
                  minWidth: 160,
                  background: '#0b1220',
                  cursor: 'pointer',
                }}
                value={newArea}
                onChange={(e) => setNewArea(e.target.value)}
              >
                {AREAS.map(([v, label]) => (
                  <option key={v} value={v}>
                    {label}
                  </option>
                ))}
              </select>
              <input
                type="number"
                min={1}
                step={1}
                style={{ ...ui.input, width: 120 }}
                value={newRequired}
                onChange={(e) => setNewRequired(e.target.value)}
              />
              <button type="submit" style={ui.btnPrimary}>
                Add
              </button>
            </div>
            <div style={{ ...ui.subtle, marginTop: 6 }}>
              “Required” = minimum number of photos for this item.
            </div>
          </form>

          {msg && (
            <div
              style={{
                marginTop: 10,
                color: msg.match(/Added|Saved|Updated|Order saved/i)
                  ? '#22c55e'
                  : '#fca5a5',
              }}
            >
              {msg}
            </div>
          )}

          {/* Existing items */}
          <div style={{ marginTop: 18, overflowX: 'auto' }}>
            {shots.length === 0 ? (
              <div style={ui.muted}>
                No items yet — add your first checklist item above.
              </div>
            ) : (
              <table
                style={{
                  width: '100%',
                  minWidth: 900,
                  borderCollapse: 'collapse',
                }}
              >
                <thead>
                  <tr
                    style={{
                      textAlign: 'left',
                      borderBottom: '1px solid #1f2937',
                    }}
                  >
                    <th style={{ padding: '10px 8px', width: 60 }}></th>
                    <th style={{ padding: '10px 8px' }}>Label</th>
                    <th style={{ padding: '10px 8px' }}>Area</th>
                    <th style={{ padding: '10px 8px', width: 120 }}>Required</th>
                    <th style={{ padding: '10px 8px', width: 260 }}>
                      Reference photos
                    </th>
                    <th style={{ padding: '10px 8px', width: 120 }}></th>
                  </tr>
                </thead>
                <tbody>
                  {shots.map((s, idx) => {
                    const refCount = Array.isArray(s.reference_paths)
                      ? s.reference_paths.length
                      : 0;
                    const isDragging = draggingId === s.id;

                    const rows = [];

                    // Reference thumbnails row (above main row)
                    if (refCount > 0) {
                      rows.push(
                        <tr key={`${s.id}-refs`}>
                          <td colSpan={6} style={{ padding: '10px 8px 4px' }}>
                            <div
                              style={{
                                borderRadius: 10,
                                border: '1px solid #1f2937',
                                background: '#020617',
                                padding: '8px 10px',
                              }}
                            >
                              <div
                                style={{
                                  fontSize: 12,
                                  color: '#9ca3af',
                                  marginBottom: 6,
                                  fontWeight: 600,
                                }}
                              >
                                Reference photo
                                {refCount > 1 ? 's' : ''} for {s.label}
                              </div>
                              <div
                                style={{
                                  display: 'flex',
                                  flexWrap: 'wrap',
                                  gap: 8,
                                }}
                              >
                                {s.reference_paths.map((path) => {
                                  if (!thumbByPath[path]) ensureThumb(path);
                                  const thumb = thumbByPath[path] || null;

                                  return (
                                    <div
                                      key={path}
                                      style={{
                                        position: 'relative',
                                        width: 72,
                                        height: 72,
                                        borderRadius: 8,
                                        overflow: 'hidden',
                                        border: '1px solid #374151',
                                        background: '#020617',
                                        cursor: 'pointer',
                                      }}
                                      onClick={(e) => {
                                        if (e.target.dataset?.role === 'delete-ref') return;
                                        openSignedPath(path);
                                      }}
                                    >
                                      {thumb ? (
                                        <img
                                          src={thumb}
                                          alt="Reference"
                                          style={{
                                            width: '100%',
                                            height: '100%',
                                            objectFit: 'cover',
                                          }}
                                        />
                                      ) : (
                                        <div
                                          style={{
                                            width: '100%',
                                            height: '100%',
                                            background: '#0f172a',
                                          }}
                                        />
                                      )}
                                      <button
                                        type="button"
                                        data-role="delete-ref"
                                        onClick={() =>
                                          handleDeleteRefPhoto(s.id, path)
                                        }
                                        style={{
                                          position: 'absolute',
                                          top: 2,
                                          right: 2,
                                          width: 18,
                                          height: 18,
                                          borderRadius: '999px',
                                          border: 'none',
                                          background: '#7f1d1d',
                                          color: '#fee2e2',
                                          fontSize: 11,
                                          cursor: 'pointer',
                                          display: 'flex',
                                          alignItems: 'center',
                                          justifyContent: 'center',
                                        }}
                                        title="Delete reference photo"
                                      >
                                        ✕
                                      </button>
                                    </div>
                                  );
                                })}
                              </div>
                            </div>
                          </td>
                        </tr>
                      );
                    }

                    // Main row (draggable + up/down buttons)
                    rows.push(
                      <tr
                        key={s.id}
                        draggable
                        onDragStart={() => handleDragStart(s.id)}
                        onDragOver={(e) => e.preventDefault()}
                        onDrop={() => handleRowDrop(s.id)}
                        onDragEnd={handleDragEnd}
                        style={{
                          borderBottom: '1px solid #111827',
                          background: isDragging ? '#020617' : 'transparent',
                          opacity: isDragging ? 0.85 : 1,
                        }}
                      >
                        <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                            <span style={{ fontSize: 16, color: '#6b7280', cursor: 'grab' }}>⋮⋮</span>
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                              <button
                                type="button"
                                onClick={() => moveShot(s.id, -1)}
                                disabled={idx === 0}
                                style={{
                                  width: 20, height: 18, borderRadius: 4,
                                  border: '1px solid #374151',
                                  background: '#020617',
                                  color: '#9ca3af',
                                  fontSize: 10,
                                  cursor: idx === 0 ? 'default' : 'pointer',
                                }}
                                title="Move up"
                              >
                                ▲
                              </button>
                              <button
                                type="button"
                                onClick={() => moveShot(s.id, +1)}
                                disabled={idx === shots.length - 1}
                                style={{
                                  width: 20, height: 18, borderRadius: 4,
                                  border: '1px solid #374151',
                                  background: '#020617',
                                  color: '#9ca3af',
                                  fontSize: 10,
                                  cursor: idx === shots.length - 1 ? 'default' : 'pointer',
                                }}
                                title="Move down"
                              >
                                ▼
                              </button>
                            </div>
                          </div>
                        </td>

                        <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                          <input
                            type="text"
                            value={s.label || ''}
                            onChange={(e) => updateLabel(s.id, e.target.value)}
                            style={{ ...ui.input }}
                          />
                        </td>

                        <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                          <select
                            value={s.area_key || 'general'}
                            onChange={(e) => updateArea(s.id, e.target.value)}
                            style={{ ...ui.input, background: '#0b1220', cursor: 'pointer' }}
                          >
                            {AREAS.map(([v, label]) => (
                              <option key={v} value={v}>{label}</option>
                            ))}
                          </select>
                        </td>

                        <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                          <input
                            type="number"
                            min={1}
                            step={1}
                            value={s.min_count || 1}
                            onChange={(e) => updateRequired(s.id, e.target.value)}
                            style={{ ...ui.input }}
                          />
                        </td>

                        <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                          <input
                            type="file"
                            accept="image/*"
                            style={{ display: 'none' }}
                            ref={(el) => { refInputs.current[s.id] = el; }}
                            onChange={(e) => handleRefFileChange(s, e)}
                          />
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <div style={{ fontSize: 12, color: '#9ca3af' }}>
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

                        <td style={{ padding: '10px 8px', verticalAlign: 'top' }}>
                          <button onClick={() => deleteShot(s.id)} style={ui.btnSecondary}>
                            Delete
                          </button>
                        </td>
                      </tr>
                    );

                    return rows;
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>

<div style={{ ...ui.row }}>
  <button
    type="button"
    onClick={() => router.push(`/properties/${property.id}/invite`)}
    style={ui.btnPrimary}
  >
    Invite cleaner
  </button>

  <button
    type="button"
    onClick={() =>
      router.push(`/turns/preview/capture?preview=1&property_id=${property.id}`)
    }
    style={ui.btnSecondary}
  >
    Preview as cleaner (no data saved)
  </button>

  <button
    type="button"
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
