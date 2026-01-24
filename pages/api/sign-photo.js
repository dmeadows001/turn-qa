// pages/api/sign-photo.js
import { supabaseAdmin } from "../../lib/supabase";
import { readCleanerSession } from "../../lib/session";

function getBearerToken(req) {
  const h = req.headers.authorization || "";
  const m = h.match(/^Bearer\s+(.+)$/i);
  return m ? m[1].trim() : null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") return res.status(405).json({ error: "Method not allowed" });

    const body = typeof req.body === "string" ? JSON.parse(req.body) : req.body;
    const rawPath = String(body.path || "");
    const path = rawPath.replace(/^photos\//, ""); // bucket is "photos", so normalize
    const expires = Math.min(Math.max(parseInt(body.expires || 300, 10) || 300, 30), 3600); // 30s–1h

    if (!path) return res.status(400).json({ error: "Missing path" });

// 1) Auth: Prefer Bearer token; fallback to cleaner cookie session
const token = getBearerToken(req);

let managerId = null;
let cleanerId = null;

if (token) {
  const { data: userData, error: userErr } = await supabaseAdmin.auth.getUser(token);
  if (userErr || !userData?.user) return res.status(401).json({ error: "Invalid/expired token" });

  const userId = userData.user.id;

  // 2) Identify role (manager / cleaner) by user_id
  const [{ data: mgrRow }, { data: clnRow }] = await Promise.all([
    supabaseAdmin.from("managers").select("id").eq("user_id", userId).maybeSingle(),
    supabaseAdmin.from("cleaners").select("id").eq("user_id", userId).maybeSingle(),
  ]);

  managerId = mgrRow?.id || null;
  cleanerId = clnRow?.id || null;

  if (!managerId && !cleanerId) {
    return res.status(403).json({ error: "Not authorized (no role)" });
  }
} else {
  // Cleaner OTP session fallback (no bearer token)
  const cleanerSess = readCleanerSession(req);
  if (!cleanerSess?.cleaner_id) {
    return res.status(401).json({ error: "Missing Authorization token" });
  }
  cleanerId = cleanerSess.cleaner_id;
}

    // 3) Authorization checks based on what the path refers to

    // ---- A) Turn photos (stored in turn_photos.storage_path)
    // Try to find a matching turn photo row for this storage path
    const { data: tp } = await supabaseAdmin
      .from("turn_photos")
      .select("turn_id, storage_path")
      .eq("storage_path", path)
      .maybeSingle();

    if (tp?.turn_id) {
      const { data: turnRow, error: turnErr } = await supabaseAdmin
        .from("turns")
        .select("id, manager_id, cleaner_id")
        .eq("id", tp.turn_id)
        .single();

      if (turnErr || !turnRow) return res.status(403).json({ error: "Not authorized (turn not found)" });

      const ok =
        (managerId && turnRow.manager_id === managerId) ||
        (cleanerId && turnRow.cleaner_id === cleanerId);

      if (!ok) return res.status(403).json({ error: "Not authorized (turn)" });

      const { data, error } = await supabaseAdmin.storage.from("photos").createSignedUrl(path, expires);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    // ---- B) Reference photos (refs/<shotId>/...)
    // These are uploaded from the template builder.
    if (path.startsWith("refs/")) {
      const parts = path.split("/");
      const shotId = parts[1]; // refs/<shotId>/filename
      if (!shotId) return res.status(403).json({ error: "Not authorized (bad refs path)" });

      // Resolve shot -> template -> property -> properties.manager_id
      const { data: shotRow, error: shotErr } = await supabaseAdmin
        .from("template_shots")
        .select("id, template_id")
        .eq("id", shotId)
        .single();

      if (shotErr || !shotRow) return res.status(403).json({ error: "Not authorized (shot)" });

      const { data: tplRow, error: tplErr } = await supabaseAdmin
        .from("property_templates")
        .select("id, property_id")
        .eq("id", shotRow.template_id)
        .single();

      if (tplErr || !tplRow) return res.status(403).json({ error: "Not authorized (template)" });

      const { data: propRow, error: propErr } = await supabaseAdmin
        .from("properties")
        .select("id, manager_id")
        .eq("id", tplRow.property_id)
        .single();

      if (propErr || !propRow) return res.status(403).json({ error: "Not authorized (property)" });

      const managerOk = managerId && propRow.manager_id === managerId;

      let cleanerOk = false;
      if (!managerOk && cleanerId) {
        // allow assigned cleaners to view reference photos for that property
      const [cp, pc] = await Promise.all([
        supabaseAdmin
          .from("cleaner_properties")
          .select("id")
          .eq("cleaner_id", cleanerId)
          .eq("property_id", propRow.id)
          .maybeSingle(),
        supabaseAdmin
          .from("property_cleaners")
          .select("id")
          .eq("cleaner_id", cleanerId)
          .eq("property_id", propRow.id)
          .maybeSingle(),
      ]);

      cleanerOk = !!cp?.data?.id || !!pc?.data?.id;


      if (!managerOk && !cleanerOk) return res.status(403).json({ error: "Not authorized (refs)" });

      const { data, error } = await supabaseAdmin.storage.from("photos").createSignedUrl(path, expires);
      if (error) throw error;
      return res.status(200).json({ url: data.signedUrl });
    }

    // ---- C) Default deny for anything else
    return res.status(403).json({ error: "Not authorized (unknown path type)" });
  } catch (e) {
    console.error("sign-photo error:", e);
    return res.status(500).json({ error: "sign-photo failed" });
  }
}
