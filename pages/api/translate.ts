// pages/api/translate.ts
import type { NextApiRequest, NextApiResponse } from 'next';

type ReqBody = {
  text?: string;
  targetLang?: 'es' | 'en';
};

function pickOutputText(data: any): string {
  if (typeof data?.output_text === 'string' && data.output_text.trim()) return data.output_text.trim();

  const out = data?.output;
  if (Array.isArray(out)) {
    const texts: string[] = [];
    for (const item of out) {
      const content = item?.content;
      if (!Array.isArray(content)) continue;
      for (const c of content) {
        if (typeof c?.text === 'string') texts.push(c.text);
      }
    }
    const joined = texts.join('').trim();
    if (joined) return joined;
  }
  return '';
}

export default async function handler(req: NextApiRequest, res: NextApiResponse) {
  try {
    if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' });

    const { text, targetLang } = (req.body || {}) as ReqBody;
    const clean = String(text || '').trim();
    const lang = targetLang === 'es' || targetLang === 'en' ? targetLang : null;

    if (!clean) return res.status(400).json({ error: 'Missing text' });
    if (!lang) return res.status(400).json({ error: 'Missing targetLang (es|en)' });

    const key = process.env.OPENAI_API_KEY;
    if (!key) return res.status(500).json({ error: 'Missing OPENAI_API_KEY on server' });

    const system = `You are a translation engine. Translate the user's text into ${
      lang === 'es' ? 'Spanish' : 'English'
    }.
Rules:
- Output ONLY the translated text.
- Keep meaning and tone.
- Keep any numbers, names, and addresses unchanged.
- Do not add quotes or explanations.`;

    const r = await fetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${key}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'gpt-4o-mini',
        input: [
          { role: 'system', content: [{ type: 'input_text', text: system }] },
          { role: 'user', content: [{ type: 'input_text', text: clean }] },
        ],
      }),
    });

    const data = await r.json();
    if (!r.ok) return res.status(500).json({ error: data?.error?.message || 'Translate failed' });

    const translatedText = pickOutputText(data);
    if (!translatedText) return res.status(500).json({ error: 'No translated text returned' });

    return res.status(200).json({ translatedText });
  } catch (e: any) {
    return res.status(500).json({ error: e?.message || 'failed' });
  }
}
