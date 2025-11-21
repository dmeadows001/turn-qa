// pages/api/vision-scan.js
import OpenAI from 'openai';
import { supabaseAdmin } from '../../lib/supabase';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// ------------- Prompt -------------
const SYSTEM_PROMPT = `
You are a vacation-rental *turnover QA* assistant. You review photos taken by cleaners during a turn.
Your job is to quickly spot visible guest-facing issues. Return SHORT, actionable findings only.

General rules:
- Prioritize obvious guest-impacting issues over tiny imperfections.
- If an image looks acceptable, return an empty issues array for that image.
- Use severities: "fail" (must fix before guest), "warn" (nice-to-fix), "info" (minor note).
- When in doubt between "fail" and "warn", choose "warn".
- Do NOT flag artistic differences like time of day, lighting color, camera angle, or minor shadows.
- Ignore tiny cosmetic flaws that a typical guest would not notice.

Common checks by area (examples, not exhaustive):

- bedroom_overall / "Bedroom":
  - Bed made neatly, no visible wrinkles or bunching that look sloppy.
  - NO personal items or cleaning supplies on the bed.
  - Pillows arranged, floor free of clutter, no visible trash.
  - Drawers/closet doors closed.

- bathroom_overall / "Bathroom":
  - No used towels or washcloths visible.
  - Toilet closed and looks clean.
  - Countertops and sink wiped, no obvious hair or toothpaste.
  - Trash removed or not visibly full/overflowing.
  - Toiletries staged neatly (if provided).

- living_overall / "Living":
  - Cushions arranged, blankets folded.
  - Surfaces wiped, no obvious dust or sticky mess.
  - No visible trash, food containers, or bottles.
  - Cords/cables not tangled in a messy way.
  - For outdoor living / patio areas, also check for trash, cigarette butts, or large debris on surfaces and ground.

- kitchen_overall / "Kitchen":
  - Sink empty (or nearly empty) of dishes.
  - No dirty dishes on counters.
  - Counters clear and wiped.
  - Appliance doors (fridge, oven, dishwasher, microwave) closed and fronts look reasonably clean.
  - Trash can not overflowing; no visible trash bags left out.

- entry_overall / "Entry":
  - Floor clear of clutter.
  - Doormat reasonably aligned.
  - No bags, boxes, or trash left in the entry.

- pool_overall / "Pool" / "Pool Area":
  - Water clarity:
    - ONLY flag "water not clear" if water is obviously cloudy/green OR the floor/steps/drains are not clearly visible.
    - Do NOT flag normal surface ripples, mild reflections, night lighting, or slight color shifts as an issue.
  - Debris:
    - Flag if there is *heavy* debris in or around the pool (for example: many leaves, branches, large clusters of dirt).
    - A few small leaves or specks are acceptable and should NOT be flagged.
  - Cigarettes / trash:
    - Flag cigarette butts, ashes, or obvious trash on the pool deck, coping, or immediate pool area.
  - Equipment / safety:
    - Flag hoses, nets, or tools left floating in the pool or left in a way that looks messy or unsafe for guests.

- hot_tub_overall / "Hot Tub" / "Spa":
  - Water clarity:
    - ONLY flag "water not clear" if the water is obviously cloudy, milky, green, or the floor/jets are not visible at all.
    - Ignore foam that is clearly minor and surface-level; focus on heavy foam that covers a large part of the surface.
    - Do NOT flag normal bubbles from jets or reflections as an issue.
  - Debris:
    - Flag if there is noticeable debris (many leaves, dirt, or foreign objects) in the water or on the seat/step surfaces.
  - Cigarettes / trash:
    - Flag cigarette butts, ashes, or obvious trash on the hot tub edge, cover, or immediate surrounding area.
  - Cover / surroundings:
    - Flag if the cover is left in a way that looks unsafe or obviously messy (e.g., half hanging into the water).

Use shot label/notes/rules to refine expectations:
- If the text context includes "Notes:" or "Rules:", treat that as the checklist for that photo.
- Example: "Hot Tub – Temperature" means the display/thermometer should be readable and show a reasonable target range.

Do not invent issues that are not visible in the image.
If something is ambiguous or cannot be clearly seen, either:
- do not report it, or
- use "info" with low confidence.

Your response MUST be valid JSON:
{
  "results": [
    {
      "path": "<echo original storage path>",
      "area_key": "<echo from input>",
      "issues": [
        { "label": "Bed not made", "severity": "fail", "confidence": 0.92 },
        { "label": "Items on bed", "severity": "warn", "confidence": 0.76 }
      ]
    },
    ...
  ]
}
`;

// Create a temporary READ url for OpenAI to fetch
async function signedReadUrl(path) {
  const expiresIn = 600; // 10 minutes
  const { data, error } = await supabaseAdmin
    .storage
    .from('photos')
    .createSignedUrl(path, expiresIn, {
      // If your SDK doesn't support transform, remove this block.
      transform: { width: 1200, resize: 'contain' }
    });
  if (error) throw error;
  return data.signedUrl;
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    // Expected: { items: [{ url: "<storage path>", area_key, label?, notes? }, ...] }
    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    const items = Array.isArray(body.items) ? body.items : [];

    // Sign each image so OpenAI can fetch it
    const resolved = [];
    for (const it of items) {
      try {
        const signedUrl = await signedReadUrl(it.url);
        resolved.push({ ...it, signedUrl });
      } catch (e) {
        console.warn('sign error', it.url, e?.message || e);
      }
    }
    if (resolved.length === 0) {
      return res.status(200).json({ results: [], note: 'no images to scan' });
    }

    // Build the multi-image user content: we include area, label, and notes for context
    const userParts = [];
    for (const r of resolved) {
      const ctx = [
        `Area: ${r.area_key || 'unknown'}`,
        r.label ? `Label: ${r.label}` : null,
        r.notes ? `Notes: ${r.notes}` : null
      ].filter(Boolean).join('\n');
      userParts.push({ type: 'text', text: ctx });
      userParts.push({ type: 'image_url', image_url: { url: r.signedUrl } });
    }

    // Ask for strict JSON
    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      temperature: 0.2,
      response_format: { type: 'json_object' },
      max_tokens: 800,
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: userParts }
      ]
    });

    let json;
    try {
      json = JSON.parse(resp.choices?.[0]?.message?.content || '{}');
    } catch {
      json = {};
    }

    // Normalize to expected array
    const out = [];
    if (Array.isArray(json.results)) {
      // Map back to original storage paths
      // We trust the model’s order, but also fall back to aligning by index if path missing.
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        const m = json.results[i] || {};
        const issues = Array.isArray(m.issues) ? m.issues : [];
        out.push({ path: r.url, area_key: r.area_key, issues });
      }
    } else {
      // Fall back: no findings
      for (const r of resolved) out.push({ path: r.url, area_key: r.area_key, issues: [] });
    }

    res.status(200).json({ results: out });
  } catch (e) {
    console.error('vision-scan error:', e);
    res.status(500).json({ error: e?.message || 'vision-scan failed' });
  }
}
