// pages/turns/[id]/done.js
import { useRouter } from 'next/router';
import { useEffect, useState } from 'react';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

export default function TurnDone() {
  const router = useRouter();
  const turnId = router.query.id;
  const [propertyName, setPropertyName] = useState('');
  const [phone, setPhone] = useState('');

  // Pull property / checklist names so the cleaner sees context
  useEffect(() => {
    async function load() {
      if (!turnId) return;
      try {
        const r = await fetch(`/api/turn-template?turnId=${turnId}`);
        const j = await r.json().catch(() => ({}));
        if (j?.rules?.property) setPropertyName(j.rules.property);
      } catch {}
    }
    load();
  }, [turnId]);

  // Try to discover the cleaner's phone from localStorage (best effort)
  useEffect(() => {
    try {
      const keys = ['turnqa_phone', 'cleaner_phone', 'lastCleanerPhone', 'otp_phone'];
      for (const k of keys) {
        const v = window.localStorage.getItem(k);
        if (v && typeof v === 'string' && v.trim()) {
          setPhone(v.trim());
          window.localStorage.setItem('turnqa_phone', v.trim());
          break;
        }
      }
    } catch {}
  }, []);

  const mySubmissionsHref = phone ? `/cleaner/turns?phone=${encodeURIComponent(phone)}` : '/cleaner/turns';

  return (
    <ChromeDark title="Turn submitted">
      <section style={ui.sectionGrid}>
        <div style={ui.card}>
          <h2 style={{ textAlign:'center', margin:'0 0 6px' }}>Turn submitted</h2>
          {propertyName ? (
            <div style={{ textAlign:'center', color:'#94a3b8', marginBottom:8 }}>
              {propertyName}
            </div>
          ) : null}

          <p style={{ ...ui.muted, marginTop:8 }}>
            Your photos were sent to the manager. You’ll be notified if they approve or request fixes.
          </p>
          <p style={{ color:'#e5e7eb', marginTop:6 }}>
            <b>Payment</b>: your pay will trigger <b>after manager approval</b>. You’ll receive an SMS when it’s approved.
          </p>

          <div style={{ display:'flex', gap:12, flexWrap:'wrap', marginTop:16 }}>
            <a href={mySubmissionsHref} style={ui.btnPrimary}>See my submissions</a>
            <a href="/capture" style={ui.btnSecondary}>Start another turn</a>
          </div>

          <div style={{ ...ui.subtle, marginTop:16 }}>
            Keep this page for your records: <code style={{ userSelect:'all' }}>{turnId}</code>
          </div>
        </div>
      </section>
    </ChromeDark>
  );
}
