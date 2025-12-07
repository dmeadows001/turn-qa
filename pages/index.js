// pages/index.js
import Link from 'next/link';
import { useEffect, useState } from 'react';
import Image from 'next/image';
import ChromeDark from '../components/ChromeDark';
import { ui } from '../lib/theme';
import { supabaseBrowser } from '@/lib/supabaseBrowser';

export default function Home() {
  const [session, setSession] = useState(null);

  useEffect(() => {
    const supabase = supabaseBrowser();
    supabase.auth.getSession().then(({ data }) => setSession(data.session || null));
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s));
    return () => sub.subscription.unsubscribe();
  }, []);

  const year = new Date().getFullYear();

  return (
    <ChromeDark
      title={
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 12 }}>
          <Image src="/logo-camera.svg" alt="" width={36} height={36} priority />
          <span>TurnQA</span>
        </span>
      }
    >
      <section style={ui.sectionGrid}>
        {/* Managers card */}
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Managers</h2>
          <p style={ui.muted}>
            TurnQA helps short-term rental hosts and managers verify every cleaning “turn” with
            photos before the next guest arrives.
          </p>
          <p style={{ ...ui.muted, marginTop: 8 }}>
            New here? Start a free trial. Already using TurnQA? Sign in to your dashboard.
          </p>
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginTop: 12 }}>
            {session ? (
              <Link href="/dashboard" style={{ ...ui.btnPrimary, textAlign: 'center' }}>
                Go to dashboard
              </Link>
            ) : (
              <>
                <Link href="/signup" style={ui.btnPrimary}>
                  Start free trial
                </Link>
                <Link href="/login" style={ui.btnSecondary}>
                  Manager sign in
                </Link>
              </>
            )}
          </div>
        </div>

        {/* Cleaners card */}
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>Cleaners</h2>
          <p style={ui.muted}>
            Cleaners don’t create accounts on this page. Your manager adds you in TurnQA and you’ll
            receive a secure SMS invite with a link to:
          </p>
          <ul style={{ margin: '8px 0 0 18px', color: '#cbd5e1', fontSize: 14 }}>
            <li>Verify your phone number</li>
            <li>Open the photo checklist for a job</li>
            <li>Upload “before &amp; after” photos from your camera or library</li>
          </ul>
          <p style={{ ...ui.muted, marginTop: 10, fontSize: 12 }}>
            SMS messages are transactional and related to job activity only. Message &amp; data
            rates may apply. Reply <strong>STOP</strong> to opt out, <strong>HELP</strong> for help.
            See our{' '}
            <Link href="/legal/sms-terms" style={{ textDecoration: 'underline' }}>
              SMS Terms
            </Link>{' '}
            and{' '}
            <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>
              Privacy Policy
            </Link>
            .
          </p>
        </div>

        {/* How it works card */}
        <div style={ui.card}>
          <h2 style={{ marginTop: 0, marginBottom: 6 }}>How it works</h2>
          <ol style={{ margin: '8px 0 0 18px', color: '#cbd5e1' }}>
            <li>Start a free trial and create one or more properties.</li>
            <li>Build a room-by-room photo checklist for each property.</li>
            <li>Invite a cleaner by SMS from inside TurnQA.</li>
            <li>Cleaner uploads photos via the secure capture link.</li>
            <li>Manager reviews, requests fixes if needed, and approves the turn.</li>
          </ol>
        </div>
      </section>

      {/* Simple footer with legal links */}
<footer
  style={{
    marginTop: 32,
    paddingTop: 16,
    borderTop: '1px solid #1f2937',
    fontSize: 12,
    color: '#64748b',
    display: 'flex',
    flexWrap: 'wrap',
    gap: 12,
    justifyContent: 'space-between',
    alignItems: 'center',
  }}
>
  <span>© {year} TurnQA. All rights reserved.</span>
  <span style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
    <Link href="/legal/terms" style={{ textDecoration: 'underline' }}>
      Terms of Service
    </Link>
    <Link href="/legal/privacy" style={{ textDecoration: 'underline' }}>
      Privacy Policy
    </Link>
    <Link href="/legal/sms-terms" style={{ textDecoration: 'underline' }}>
      SMS Terms
    </Link>
  </span>
</footer>
    </ChromeDark>
  );
}
