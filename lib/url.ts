// lib/url.ts
import type { NextApiRequest } from "next";

// Best-effort base URL in all environments
export function getBaseUrl(req?: NextApiRequest) {
  const envUrl =
    process.env.NEXT_PUBLIC_SITE_URL ||
    process.env.VERCEL_URL; // e.g. turn-qa.vercel.app
  if (envUrl) return envUrl.startsWith("http") ? envUrl : `https://${envUrl}`;
  // Fallback to request host during API calls / local dev
  const host = req?.headers?.host;
  return host ? `http://${host}` : "http://localhost:3000";
}

export function managerReviewUrl(turnId: string, req?: NextApiRequest) {
  const base = getBaseUrl(req);
  return `${base}/manager/turns/${encodeURIComponent(
    turnId
  )}/review?manager=1`;
}
