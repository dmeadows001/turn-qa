// pages/admin/properties/[id].js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import Link from 'next/link';

function emptyRow(i=0) {
  return { area_key:'', label:'', min_count:1, notes:'', sort_order: i*10 };
}

export default function PropertyTemplateEditor() {
  const { query } = useRouter();
  const id = query.id;

  const [prop, setProp] = useState(null);
  const [rows, setRows] = useState(null); // null = loading
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!id) return;
    (async () => {
      // load property
      const p = await fetch(`/api/properties/${id}`).then(r=>r.json()).catch(()=>null);
      setProp(p?.property || null);

      // load shots
      const s = await fetch(`/api/properties/${id}/shots`).then(r=>r.json()).catch(()=>null);
      const shots = s?.shots || [];
      setRows(shots.length ? shots.map(x => ({
        area_key: x.area_key,
        label: x.label,
        min_count: x.min_count || 1,
        notes: x.notes || '',
        sort_order: x.sort_order || 0
      })) : [emptyRow(), emptyRow(1), emptyRow(2)]);
    })();
  }, [id]);

  function updateRow(idx, patch) {
    setRows(prev => prev.map((r,i) => i===idx ? { ...r, ...patch } : r));
  }
  function addRow() {
    setRows(prev => [...prev, emptyRow(prev.length)]);
  }
  function removeRow(idx) {
    setRows(prev => prev.filter((_,i)=>i!==idx));
  }
  function moveRow(idx, dir) {
    setRows(prev => {
      const next = [...prev];
      const j = idx + dir;
      if (j < 0 || j >= next.length) return prev;
      [next[idx], next[j]] = [next[j], next[idx]];
      // re-number sort_order
      return next.map((r,i) => ({ ...r, sort_order: i*10 }));
    });
  }

  async function saveAll() {
    const cleaned = rows
      .map((r,i)=>({
        area_key: r.area_key.trim(),
        label: r.label.trim(),
        min_count: Math.max(1, Number(r.min_count||1)),
        notes: r.notes?.trim() || '',
        sort_order: i*10
      }))
      .filter(r => r.area_key && r.label);

    if (cleaned.length === 0) return alert('Please enter at least one shot with area_key and label.');

    setSaving(true);
    const r = await fetch(`/api/properties/${id}/shots`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ shots: cleaned })
    });
    setSaving(false);
    if (!r.ok) {
      const j = await r.json().catch(()=>({}));
      alert('Save failed: ' + (j.error || r.statusText));
      return;
    }
    alert('Template saved.');
  }

  if (!id || rows === null) return <div style={{ padding:24 }}>Loading…</div>;

  return (
    <div style={{ maxWidth: 1000, margin: '24px auto', padding: '0 16px', fontFamily:'ui-sans-serif' }}>
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <Link href="/admin/properties" style={{ color:'#2563eb' }}>← Back</Link>
        <h1 style={{ margin:0 }}>{prop ? prop.name : 'Property'}</h1>
      </div>
      <p style={{ color:'#555' }}>Define the required photos (shots) for cleaners at this property.</p>

      <div style={{ overflowX:'auto' }}>
        <table width="100%" cellPadding="6" style={{ borderCollapse:'collapse', minWidth: 720 }}>
          <thead>
            <tr style={{ background:'#f8fafc', textAlign:'left' }}>
              <th style={{ width:160 }}>Area Key</th>
              <th>Label (shown to cleaner)</th>
              <th style={{ width:110 }}>Min Count</th>
              <th>Notes (optional)</th>
              <th style={{ width:140 }}></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r, idx) => (
              <tr key={idx} style={{ borderTop:'1px solid #e5e7eb' }}>
                <td>
                  <input value={r.area_key} onChange={e=>updateRow(idx,{area_key:e.target.value})}
                         placeholder="bathroom_overall" style={{ width:'100%', padding:6 }}/>
                </td>
                <td>
                  <input value={r.label} onChange={e=>updateRow(idx,{label:e.target.value})}
                         placeholder="Bathroom - Overall" style={{ width:'100%', padding:6 }}/>
                </td>
                <td>
                  <input type="number" min={1} value={r.min_count}
                         onChange={e=>updateRow(idx,{min_count:e.target.value})}
                         style={{ width:100, padding:6 }}/>
                </td>
                <td>
                  <input value={r.notes} onChange={e=>updateRow(idx,{notes:e.target.value})}
                         placeholder="What to capture..." style={{ width:'100%', padding:6 }}/>
                </td>
                <td>
                  <div style={{ display:'flex', gap:6 }}>
                    <button onClick={()=>moveRow(idx,-1)} disabled={idx===0}>↑</button>
                    <button onClick={()=>moveRow(idx,1)} disabled={idx===rows.length-1}>↓</button>
                    <button onClick={()=>removeRow(idx)}>🗑️ Remove</button>
                  </div>
                </td>
              </tr>
            ))}
            <tr>
              <td colSpan={5} style={{ paddingTop:8 }}>
                <button onClick={addRow}>➕ Add Shot</button>
              </td>
            </tr>
          </tbody>
        </table>
      </div>

      <div style={{ display:'flex', gap:12, marginTop:16 }}>
        <button onClick={saveAll} disabled={saving} style={{ padding:'10px 14px' }}>
          💾 Save Template
        </button>
        {prop && (
          <a href={`/turns/${prop.id}/capture`} style={{ padding:'10px 14px', border:'1px solid #e5e7eb' }}
             onClick={(e)=>{ e.preventDefault(); alert('This link is just an example. Turns have their own UUID.'); }}>
            Preview (note: use a real Turn UUID)
          </a>
        )}
      </div>
    </div>
  );
}

