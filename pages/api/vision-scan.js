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
- Include confidence 0..1 when appropriate.

Common checks by area (examples, not exhaustive):
- bedroom_overall / "Bedroom": bed made neatly; NO items on bed; pillows arranged; floor free of clutter; trash absent; drawers/closet closed.
- bathroom_overall / "Bathroom": no used towels/face cloths visible; toilet closed/clean; surfaces wiped; trash removed; toiletries staged; no hair on surfaces.
- living_overall / "Living": cushions arranged; blankets folded; surfaces wiped; visible trash absent; cords/cables tidy.
- kitchen_overall / "Kitchen": sink empty; no dirty dishes; counters clear/wiped; appliances closed/clean; trash removed.
- entry_overall / "Entry": floor clear; doormat aligned; no bags/boxes left.

Use shot label/notes to refine expectations (e.g., "Hot Tub – Temperature" means the **display/thermometer** must be readable and show target range).
Do not invent issues not visible in the image.

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
      transform: { width: 1600, resize: 'contain' }
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
