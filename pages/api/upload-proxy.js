// pages/api/upload-proxy.js
import { supabaseAdmin as _admin } from '@/lib/supabaseAdmin';
import { readCleanerSession } from '@/lib/session';

export const config = {
  api: {
    bodyParser: false, // we stream the raw body
    sizeLimit: '10mb',
  },
};

const admin = typeof _admin === 'function' ? _admin() : _admin;

const DEFAULT_BUCKET =
  process.env.NEXT_PUBLIC_SUPABASE_STORAGE_BUCKET ||
  process.env.SUPABASE_STORAGE_BUCKET ||
  'photos';

function getBearerToken(req) {
  const h = req.headers.authorization || '';
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

function cleanPath(p) {
  return String(p || '').replace(/^\/+/, '');
}
function safePath(p) {
  const s = cleanPath(p);
  if (!s) return '';
  if (s.includes('..')) return '';
  return s;
}

function readRawBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function resolveRoleFromBearer(token) {
  const { data: userData, error: userErr } = await admin.auth.getUser(token);
  if (userErr || !userData?.user) return { ok: false, error: 'Invalid/expired token' };

  const userId = userData.user.id;

  const [{ data: mgrRow }, { data: clnRow }] = await Promise.all([
    admin.from('managers').select('id').eq('user_id', userId).maybeSingle(),
    admin.from('cleaners').select('id').eq('id', userId).maybeSingle(),
  ]);

  return {
    ok: true,
    userId,
    managerId: mgrRow?.id || null,
    cleanerId: clnRow?.id || null,
  };
}

function extractTurnIdFromPath(path) {
  // Expect: turns/<turnId>/<shotId>/...
  const p = safePath(path);
  const parts = p.split('/').filter(Boolean);
  if (parts[0] !== 'turns') return null;
  return parts[1] || null;
}

async function authorizeUpload({ turnId, managerId, cleanerId }) {
  const { data: turn, error: tErr } = await admin
    .from('turns')
    .select('id, property_id, manager_id, cleaner_id')
    .eq('id', turnId)
    .maybeSingle();

  if (tErr || !turn) return { ok: false, error: 'Turn not found' };

  if (managerId && turn.manager_id === managerId) {
    return { ok: true, turn, mode: 'manager' };
  }

  if (cleanerId && turn.cleaner_id === cleanerId) {
    return { ok: true, turn, mode: 'cleaner' };
  }

  // Cleaner assigned to property (support either table name)
  if (cleanerId && turn.property_id) {
    const [a, b] = await Promise.all([
      admin
        .from('cleaner_properties')
        .select('id')
        .eq('cleaner_id', cleanerId)
        .eq('property_id', turn.property_id)
        .maybeSingle(),
      admin
        .from('property_cleaners')
        .select('id')
        .eq('cleaner_id', cleanerId)
        .eq('property_id', turn.property_id)
        .maybeSingle(),
    ]);

    if (a?.data?.id || b?.data?.id) {
      return { ok: true, turn, mode: 'cleaner' };
    }
  }

  return { ok: false, error: 'Not authorized (turn)' };
}

export default async function handler(req, res) {
  if (req.method !== 'PUT') {
    res.setHeader('Allow', ['PUT']);
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const bucketRaw = String(req.query.bucket || '').trim();
    const pathRaw = String(req.query.path || '').trim();

    const bucket = bucketRaw || DEFAULT_BUCKET;
    const path = safePath(pathRaw);

    if (!bucket || !path) {
      return res.status(400).json({ error: 'bucket and path are required' });
    }

    // Only allow uploads into the expected bucket (prevents abuse)
    if (bucket !== DEFAULT_BUCKET) {
      return res.status(403).json({ error: 'Not authorized (bucket)' });
    }

    // Only allow uploads under turns/<turnId>/...
    const turnId = extractTurnIdFromPath(path);
    if (!turnId) {
      return res.status(403).json({ error: 'Not authorized (path)' });
    }

    // Auth: either manager/cleaner Supabase Bearer token OR cleaner cookie session
    const token = getBearerToken(req);
    const cleanerSess = !token ? readCleanerSession(req) : null;

    let managerId = null;
    let cleanerId = null;

    if (token) {
      const role = await resolveRoleFromBearer(token);
      if (!role.ok) return res.status(401).json({ error: role.error || 'Unauthorized' });

      managerId = role.managerId;
      cleanerId = role.cleanerId;

      if (!managerId && !cleanerId) {
        return res.status(403).json({ error: 'Not authorized (no role)' });
      }
    } else if (cleanerSess?.cleaner_id) {
      cleanerId = cleanerSess.cleaner_id;
    } else {
      return res.status(401).json({ error: 'Missing Authorization token or cleaner session' });
    }

    // Authorization for this turn upload
    const authz = await authorizeUpload({ turnId, managerId, cleanerId });
    if (!authz.ok) {
      return res.status(403).json({ error: authz.error || 'Not authorized' });
    }

    const contentType = req.headers['content-type'] || 'application/octet-stream';
    const body = await readRawBody(req);

    const { error } = await admin.storage.from(bucket).upload(path, body, {
      contentType,
      upsert: false,
    });

    if (error) {
      console.error('[upload-proxy] storage.upload error:', error.message || error);
      return res.status(500).json({ error: 'upload failed' });
    }

    return res.status(200).json({ ok: true, path });
  } catch (e) {
    console.error('[upload-proxy] fatal error', e?.message || e);
    return res.status(500).json({ error: e?.message || 'upload-proxy failed' });
  }
}
