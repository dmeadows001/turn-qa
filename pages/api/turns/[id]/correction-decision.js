// pages/api/turns/[id]/correction-decision.js
import { requireActiveSubscription } from '@/lib/requireActiveSubscription';
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';
const supa = typeof _admin === 'function' ? _admin() : _admin;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function parseBody(b) { if (typeof b !== 'string') return b || {}; try { return JSON.parse(b); } catch { return {}; } }
async function managerFor(req,res,turn) {
  const access = await requireActiveSubscription(req,res);
  if (!access.ok) return null;
  const { data: manager, error: me } = await supa.from('managers').select('id').eq('user_id',access.user.id).maybeSingle();
  if (me) throw me;
  if (!manager) { res.status(403).json({error:'Manager not found'}); return null; }
  const { data: prop, error: pe } = await supa.from('properties').select('id').eq('id',turn.property_id).eq('manager_id',manager.id).maybeSingle();
  if (pe) throw pe;
  if (!prop) { res.status(403).json({error:'Property access denied'}); return null; }
  return manager;
}
export default async function handler(req,res) {
  if (!['GET','POST'].includes(req.method)) { res.setHeader('Allow',['GET','POST']); return res.status(405).json({error:'Method Not Allowed'}); }
  const turnId = String(req.query.id || '');
  if (!UUID.test(turnId)) return res.status(400).json({error:'Invalid turn ID'});
  try {
    const { data: turn, error: te } = await supa.from('turns').select('id,property_id,cleaner_id,status').eq('id',turnId).maybeSingle();
    if (te) throw te;
    if (!turn) return res.status(404).json({error:'Turn not found'});
    if (req.method === 'GET') {
      const session = readCleanerSession(req);
      if (!session?.cleaner_id || session.cleaner_id !== turn.cleaner_id) {
        const manager = await managerFor(req,res,turn);
        if (!manager) return;
      }
      const { data, error } = await supa.from('correction_decisions')
        .select('id,turn_id,correction_task_id,photo_id,decision,manager_id,note,review_round,created_at,note_original,note_original_lang,note_translated,note_translated_lang,note_sent,note_sent_lang')
        .eq('turn_id',turnId).order('created_at',{ascending:true});
      if (error) throw error;
      return res.status(200).json({decisions:data || []});
    }
    const manager = await managerFor(req,res,turn);
    if (!manager) return;
    const b = parseBody(req.body);
    const taskId = String(b.correction_task_id || '');
    const photoId = String(b.photo_id || '');
    const decision = String(b.decision || '');
    if (!UUID.test(taskId) || !UUID.test(photoId) || !['accepted','rejected'].includes(decision))
      return res.status(400).json({error:'Invalid correction task, photo, or decision'});
    const original = String(b.note_original || '').trim();
    const translated = String(b.note_translated || '').trim();
    const sent = translated || original;
    if (decision === 'rejected' && !sent) return res.status(400).json({error:'Explain why another fix is needed'});
    if (sent.length > 4000) return res.status(400).json({error:'Note exceeds 4000 characters'});
    const { data, error } = await supa.rpc('record_turn_correction_decision',{
      p_turn_id:turnId,p_task_id:taskId,p_photo_id:photoId,p_manager_id:manager.id,p_decision:decision,
      p_note:sent || null,p_note_original:original || null,p_note_original_lang:original ? 'en':null,
      p_note_translated:translated || null,p_note_translated_lang:translated ? 'es':null,
      p_note_sent:sent || null,p_note_sent_lang:translated ? 'es':(original ? 'en':null)
    });
    if (error) {
      const code = String(error.message || '').match(/(INVALID_DECISION|REJECTION_NOTE_REQUIRED|TURN_NOT_FOUND|TURN_NOT_SUBMITTED|PROPERTY_ACCESS_DENIED|CORRECTION_PHOTO_TASK_MISMATCH|TASK_NOT_ACTIVE|STALE_CORRECTION_PHOTO|PHOTO_ALREADY_DECIDED)/)?.[1];
      if (code) return res.status(409).json({error:code});
      throw error;
    }
    // The final rejection returns the turn to needs_fix. Existing manager
    // notifications remain unchanged; do not send SMS to any other cleaner.
    return res.status(200).json(data);
  } catch(e) { console.error('[correction-decision]',e); return res.status(500).json({error:'Unable to process correction decision'}); }
}
