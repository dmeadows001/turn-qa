import { REQUIRED_AREAS } from '../../lib/requiredShots';

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { uploadsByArea = {}, required: requiredOverride } =
      typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const flags = [];

    // Prefer per-turn required list from the client; fall back to global defaults
    const REQUIRED = Array.isArray(requiredOverride) && requiredOverride.length
      ? requiredOverride
      : REQUIRED_AREAS;

    // Enforce minimum photos per required area (scoped to this turn)
    REQUIRED.forEach(a => {
      const count = (uploadsByArea[a.key] || []).length;
      if (count < a.minPhotos) flags.push(`Add ${a.minPhotos - count} more photo(s) for: ${a.title}`);
    });

    // Very naive filename heuristics so you can see it work today
    Object.entries(uploadsByArea).forEach(([area, files]) => {
      files.forEach(f => {
        const name = (f.name || '').toLowerCase();
        if (/(diaper|butt|cig|ash)/.test(name)) flags.push(`Possible issue in ${area}: filename "${f.name}"`);
        if (/(towel|rag)/.test(name) && area !== 'laundry') flags.push(`Check for left-behind towel in ${area}: "${f.name}"`);
      });
    });

    res.status(200).json({ flags: flags.length ? flags : ['No obvious issues detected by pre-check.'] });
  } catch (e) {
    console.error('vision-precheck error:', e);
    res.status(500).json({ error: 'vision-precheck failed' });
  }
}

