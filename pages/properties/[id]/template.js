// pages/properties/[id]/template.js
import { useEffect, useState, useRef } from 'react';
import { useRouter } from 'next/router';
import { supabaseBrowser } from '@/lib/supabaseBrowser';
import ChromeDark from '../../../components/ChromeDark';
import { ui } from '../../../lib/theme';

const supabase = supabaseBrowser();

// Opinionated areas; tweak as needed
const AREAS = [
  ['general', 'General'],
  ['kitchen', 'Kitchen'],
  ['bathroom', 'Bathroom'],
  ['bedroom', 'Bedroom'],
  ['living_room', 'Living room'],
  ['laundry', 'Laundry'],
  ['exterior', 'Exterior'],
  ['other', 'Other'],
];

function GettingStartedModal({ storageKey, title, children, open, setOpen }) {
  const [dontShow, setDontShow] = useState(false);

  function safeGetLS(key) {
    try { return window.localStorage.getItem(key); } catch { return null; }
  }
  function safeSetLS(key, val) {
    try { window.localStorage.setItem(key, val); } catch {}
  }

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      const seen = safeGetLS(storageKey);
      if (!seen) setOpen(true);
    } catch {
      setOpen(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [storageKey]);

  function dismiss(persist = true) {
    // persist only if caller wants to AND checkbox checked
    if (persist && dontShow) safeSetLS(storageKey, '1');
    setOpen(false);
  }

  if (!open) return null;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(2, 6, 23, 0.72)',
        zIndex: 9999,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 16,
      }}
      onClick={() => {
        // click outside closes (same as dismiss, but doesn't persist unless checkbox checked)
        dismiss(false);
      }}
    >
      <div
        style={{ ...ui.card, maxWidth: 780, width: '100%' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'start' }}>
          <div>
            <h2 style={{ margin: 0 }}>Getting Started</h2>
            <div style={{ ...ui.subtle, marginTop: 6 }}>{title}</div>
          </div>
          <button
            type="button"
            onClick={() => dismiss(true)}
            style={ui.btnSecondary}
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>

        <div style={{ marginTop: 14, color: '#cbd5e1', lineHeight: 1.45 }}>
          {children}
        </div>

        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 12, alignItems: 'center', marginTop: 16, flexWrap: 'wrap' }}>
          <label style={{ display: 'flex', gap: 8, alignItems: 'center', cursor: 'pointer', color: '#cbd5e1' }}>
            <input
              type="checkbox"
              checked={dontShow}
              onChange={(e) => setDontShow(e.target.checked)}
              style={{ transform: 'scale(1.05)' }}
            />
            Don&apos;t show this again
          </label>

          <button
            type="button"
            onClick={() => dismiss(true)}
            style={ui.btnPrimary}
          >
            Got it
          </button>
        </div>
      </div>
    </div>
  );
}

export default function TemplateBuilder() {
  const router = useRouter();
  const { id: propertyId } = router.query;
    // Verify subscription before loading property or checklist data.
  const [subscriptionAccess, setSubscriptionAccess] = useState('checking');
  const [subscriptionError, setSubscriptionError] = useState('');
  const [subscriptionRetry, setSubscriptionRetry] = useState(0);

  useEffect(() => {
    if (!router.isReady) return;

    let cancelled = false;

    setSubscriptionAccess('checking');
    setSubscriptionError('');

    (async () => {
      try {
        const { data, error } = await supabase.auth.getSession();

        if (cancelled) return;
        if (error) throw error;

        const token = data?.session?.access_token;

        if (!token) {
          router.replace('/login');
          return;
        }

        const response = await fetch('/api/billing/status', {
          method: 'GET',
          headers: {
            Authorization: `Bearer ${token}`,
          },
          credentials: 'include',
          cache: 'no-store',
        });

        if (cancelled) return;

        if (response.status === 401) {
          router.replace('/login');
          return;
        }

        const result = await response.json().catch(() => ({}));

        if (!response.ok) {
          throw new Error(
            result.error || `Subscription check failed (${response.status})`
          );
        }

        if (result.allowed !== true) {
          router.replace('/billing?reason=expired');
