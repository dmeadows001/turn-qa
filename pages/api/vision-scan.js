// pages/api/vision-scan.js
import OpenAI from 'openai';
import { supabaseAdmin } from '../../lib/supabase';

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

// Helper: get a temporary, downloadable URL for each storage path
async function signedReadUrl(path) {
  // Longer expiry to avoid timeouts during OpenAI fetch
  // 600s = 10 minutes
  const expiresIn = 600;

  // Optional: transform (downscale) to speed up downloads for AI.
  // Remove the transform block if your Supabase version doesn't support it.
  const { data, error } = await supabaseAdmin
    .storage
    .from('photos')
    .createSignedUrl(path, expiresIn, {
      // Comment this out if your Storage (or SDK) version doesn't support transforms
      transform: { width: 1600, resize: 'contain' } // keeps aspect, ~faster to fetch
    });

  if (error) throw error;
  return data.signedUrl; // direct HTTPS URL OpenAI can fetch
}

export default async function handler(req, res) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body;
    // Expected: { items: [{ url: "<storage path>", area_key: "bathroom_overall" }, ...] }
    const items = Array.isArray(body.items) ? body.items : [];

    // Resolve each storage path -> signed URL that lasts long enough
    const resolved = [];
    for (const it of items) {
      try {
        const url = await signedReadUrl(it.url);
        resolved.push({ ...it, signedUrl: url });
      } catch (e) {
        // If a single image fails to sign, skip it (don’t fail whole batch)
        console.warn('sign error', it.url, e?.message || e);
      }
    }

    if (resolved.length === 0) {
      return res.status(200).json({ results: [], note: 'no images to scan' });
    }

    // Build the vision prompt
    const sys = `You are a QA assistant checking Airbnb turn photos for missed items, trash, stray towels, dirty spots, and misc issues. 
Return concise findings; for each image include up to 3 issues max with a severity (info|warn|fail) and optional confidence 0..1. 
If clean, return an empty list for that image.`;

    const userParts = [];
    for (const r of resolved) {
      userParts.push({ type: 'text', text: `Area: ${r.area_key || 'unknown'}` });
      userParts.push({ type: 'image_url', image_url: { url: r.signedUrl } });
    }

    const resp = await client.chat.completions.create({
      model: 'gpt-4o-mini', // or another vision-capable model you prefer
      temperature: 0.2,
      messages: [
        { role: 'system', content: sys },
        {
          role: 'user',
          content: userParts
        }
      ],
      // Keep the response small
      max_tokens: 450
    });

    // Expect the model to emit a compact JSON-ish block; but to be robust,
    // we’ll parse with a fallback.
    const text = resp.choices?.[0]?.message?.content || '';
    // Try to pull JSON array if present, else fall back to simple mapping.
    let parsed = null;
    try {
      // Common pattern: the model outputs a single JSON array/object
      const jsonStart = text.indexOf('[');
      const jsonEnd = text.lastIndexOf(']');
      if (jsonStart >= 0 && jsonEnd > jsonStart) {
        parsed = JSON.parse(text.slice(jsonStart, jsonEnd + 1));
      }
    } catch (_) {}

    // If parsing failed, create a best-effort structure
    // Expected target format:
    // results: [{ path, area_key, issues: [{ label, severity, confidence? }] }]
    const results = [];
    if (Array.isArray(parsed)) {
      for (let i = 0; i < resolved.length; i++) {
        const r = resolved[i];
        const p = parsed[i];
        const issues = Array.isArray(p?.issues) ? p.issues : [];
        results.push({ path: r.url, area_key: r.area_key, issues });
      }
    } else {
      // Fallback: no structured JSON; return empty issues
      for (const r of resolved) results.push({ path: r.url, area_key: r.area_key, issues: [] });
    }

    res.status(200).json({ results });
  } catch (e) {
    console.error('vision-scan error:', e);
    res.status(500).json({ error: (e?.message || 'vision-scan failed') });
  }
}
