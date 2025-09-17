// pages/properties/[id]/template.js
import { useEffect, useState } from 'react';
import { useRouter } from 'next/router';
import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
);

export default function TemplateBuilder() {
  const router = useRouter();
  const { id: propertyId } = router.query;

  const [loading, setLoading]   = useState(true);
  const [msg, setMsg]           = useState('');
  const [property, setProperty] = useState(null);
  const [template, setTemplate] = useState(null);
  const [shots, setShots]       = useState([]);
  const [newLabel, setNewLabel] = useState('');

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
          .select('id, template_id, label, required, created_at')
          .eq('template_id', tpl.id)
          .order('created_at', { ascending: true });
        if (sErr) throw sErr;
        setShots(s || []);
        setMsg('');
      } catch (e) {
        setMsg(e.message || 'Failed to load');
      } finally {
        setLoading(false);
      }
    })();
  }, [propertyId]);

  async function addShot() {
    try {
      if (!newLabel.trim()) return;
      const { data, error } = await supabase
        .from('template_shots')
        .insert({ template_id: template.id, label: newLabel.trim(), required: true })
        .select('id, template_id, label, required, created_at')
        .single();
      if (error) throw error;
      setShots(prev => [...prev, data]);
      setNewLabel('');
    } catch (e) {
      setMsg(e.message || 'Failed to add shot');
    }
  }

  async function updateShot(id, patch) {
    try {
      const { error } = await supabase.from('template_shots').update(patch).eq('id', id);
      if (error) throw error;
      setShots(prev => prev.map(s => s.id === id ? { ...s, ...patch } : s));
    } catch (e) {
      setMsg(e.message || 'Failed to update');
    }
  }

  async function deleteShot(id) {
    try {
      const { error } = await supabase.from('template_shots').delete().eq('id', id);
      if (error) throw error;
      setShots(prev => prev.filter(s => s.id !== id));
    } catch (e) {
      setMsg(e.message || 'Failed to delete');
    }
  }

  const wrap  = { maxWidth: 860, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const card  = { border:'1px solid #e5e7eb', borderRadius:12, padding:16, background:'#fff', marginTop:16 };
  const input = { width:'100%', padding:10, borderRadius:8, border:'1px solid #cbd5e1' };
  const btn   = { padding:'8px 12px', borderRadius:8, border:'1px solid #94a3b8', background:'#f8fafc', cursor:'pointer' };

  return (
    <main style={wrap}>
      <h1>Property Template {property ? `— ${property.name}` : ''}</h1>

      <div style={card}>
        <h3>Add a checklist item</h3>
        <div style={{ display:'flex', gap:8 }}>
          <input style={{ ...input, flex:1 }} placeholder="e.g., Kitchen — sink close-up"
                 value={newLabel} onChange={e=>setNewLabel(e.target.value)} />
          <button style={btn} onClick={addShot} disabled={!template || !newLabel.trim()}>Add</button>
        </div>
      </div>

      <div style={card}>
        <h3>Checklist items</h3>
        {loading ? <div>Loading…</div> : (
          shots.length === 0 ? <div>No items yet. Add your first one above.</div> : (
            <table style={{ width:'100%', borderCollapse:'collapse' }}>
              <thead>
                <tr style={{ textAlign:'left', borderBottom:'1px solid #e5e7eb' }}>
                  <th style={{ padding:'8px 6px' }}>Label</th>
                  <th style={{ padding:'8px 6px' }}>Required</th>
                  <th style={{ padding:'8px 6px' }}></th>
                </tr>
              </thead>
              <tbody>
                {shots.map(s => (
                  <tr key={s.id} style={{ borderBottom:'1px solid #f1f5f9' }}>
                    <td style={{ padding:'8px 6px' }}>
                      <input style={input} value={s.label || ''} onChange={e=>updateShot(s.id, { label: e.target.value })} />
                    </td>
                    <td style={{ padding:'8px 6px' }}>
                      <label style={{ display:'inline-flex', alignItems:'center', gap:6 }}>
                        <input type="checkbox" checked={!!s.required} onChange={e=>updateShot(s.id, { required: e.target.checked })} />
                        Required
                      </label>
                    </td>
                    <td style={{ padding:'8px 6px', textAlign:'right' }}>
                      <button style={{...btn, borderColor:'#ef4444', background:'#fee2e2'}} onClick={()=>deleteShot(s.id)}>Delete</button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )
        )}
      </div>

      <div style={{ marginTop:16 }}>
        <a href="/dashboard">← Back to dashboard</a>
      </div>

      {msg && <div style={{ marginTop:12, color:'#b91c1c' }}>{msg}</div>}
    </main>
  );
}
