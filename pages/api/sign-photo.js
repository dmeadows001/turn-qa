// pages/api/sign-photo.js
import { supabaseAdmin } from "../../lib/supabase";

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });
    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const path = String(body.path || "").replace(/^photos\//, "");
    const expires = Math.min(Math.max(parseInt(body.expires || 300, 10) || 300, 30), 3600); // 30s–1h

    if (!path) return res.status(400).json({ error: "Missing path" });

    const { data, error } = await supabaseAdmin
      .storage
      .from("photos")
      .createSignedUrl(path, expires);

    if (error) throw error;
    res.status(200).json({ url: data.signedUrl });
  } catch (e) {
    console.error("sign-photo error:", e);
    res.status(500).json({ error: "sign-photo failed" });
  }
}
