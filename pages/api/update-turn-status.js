// pages/api/update-turn-status.js
import { supabaseAdmin } from '../../lib/supabase';

const ALLOWED = new Set(['needs_fix', 'approved', 'submitted', 'in_progress', 'cancelled']);

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const turn_id = body.turn_id;
    const new_status = body.new_status;
    const manager_note = (body.manager_note || '').slice(0, 2000);

    if (!turn_id || !new_status) return res.status(400).json({ error: 'Missing turn_id or new_status' });
    if (!ALLOWED.has(new_status)) return res.status(400).json({ error: 'Invalid status' });

    // Fetch current turn
    const { data: turn, error: getErr } = await supabaseAdmin
      .from('turns')
      .select('id, status')
      .eq('id', turn_id)
      .single();
    if (getErr || !turn) return res.status(404).json({ error: 'Turn not found' });

    // Simple guard: only allow transitions from submitted/needs_fix/in_progress
    const legalFrom = new Set(['submitted', 'needs_fix', 'in_progress']);
    if (!legalFrom.has(turn.status) && new_status !== 'needs_fix') {
      // allow setting needs_fix from approved too if you want, but we’ll keep it simple:
      return res.status(400).json({ error: `Cannot change from ${turn.status}` });
    }

    // Build patch
    const patch = { status: new_status };
    if (new_status === 'approved') patch.approved_at = new Date().toISOString();
    if (manager_note) patch.manager_notes = manager_note;

    const { error: updErr } = await supabaseAdmin
      .from('turns')
      .update(patch)
      .eq('id', turn_id);
    if (updErr) throw updErr;

    // Optional audit
    await supabaseAdmin.from('audit_log').insert([{
      actor: 'manager',
      action: 'TURN_STATUS_CHANGE',
      turn_id,
      meta: { to: new_status, note: manager_note || null }
    }]).catch(() => { /* ignore if table missing */ });

    res.status(200).json({ ok: true });
  } catch (e) {
    console.error('update-turn-status error:', e);
    res.status(500).json({ error: e.message || 'failed' });
  }
}
