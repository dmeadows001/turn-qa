// pages/api/vision-scan.js
import OpenAI from "openai";
import { supabaseAdmin } from "../../lib/supabase";

const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

const SYSTEM_PROMPT = `
You are a vacation-rental turnover QA assistant.
Look for issues a guest would notice:
- leftover items (towel, diaper, trash, razors),
- dirty surfaces (hair, crumbs, stains),
- missed spots (under tables, shower ledges, toilet base),
- blurry or obstructed photos.
Return JSON with "issues":[{"label","severity","confidence"}].
Severity must be one of: info | warn | fail.
Confidence: number between 0 and 1.
If nothing found, return {"issues":[]}.
`;

async function signPath(path) {
  // Create a short-lived signed URL so OpenAI can see the photo
  const { data, error } = await supabaseAdmin
    .storage
    .from("photos")
    .createSignedUrl(path, 60); // 60 seconds
  if (error) throw error;
  return data.signedUrl;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({ error: "Method not allowed" });
    }

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    let items = body.items || [];

    // Support uploadsByArea map → flatten to array
    if (!items.length && body.uploadsByArea) {
      items = Object.entries(body.uploadsByArea).flatMap(([area_key, arr]) =>
        (arr || []).map(it => ({ ...it, area_key }))
      );
    }

    if (!items.length) {
      return res.status(400).json({ error: "No items to scan" });
    }

    const results = [];
    for (const it of items) {
      const signedUrl = await signPath(it.url);

      const completion = await client.chat.completions.create({
        model: "gpt-4o-mini",
        max_tokens: 250,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          {
            role: "user",
            content: [
              { type: "text", text: `Area: ${it.area_key || "unknown"} — analyze this photo for cleanliness issues. Respond JSON only.` },
              { type: "image_url", image_url: { url: signedUrl } }
            ]
          }
        ]
      });

      let issues = [];
      try {
        const txt = completion.choices?.[0]?.message?.content || "{}";
        const parsed = JSON.parse(txt);
        if (Array.isArray(parsed.issues)) issues = parsed.issues;
      } catch (_) {}

      results.push({
        path: it.url,
        area_key: it.area_key || null,
        issues
      });
    }

    res.status(200).json({ results });
  } catch (e) {
    console.error("vision-scan error:", e);
    res.status(500).json({ error: "vision-scan failed" });
  }
}
