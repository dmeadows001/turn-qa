// pages/contact.js
import Link from 'next/link';
import Image from 'next/image';
import ChromeDark from '../components/ChromeDark';
import { ui } from '../lib/theme';

export default function ContactPage() {
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
        <div style={ui.card}>
          <h1 style={{ marginTop: 0, marginBottom: 8 }}>Contact</h1>
          <p style={ui.muted}>
            Need help with TurnQA access, SMS job alerts, or anything else? Reach us here:
          </p>

          <div style={{ marginTop: 14, lineHeight: 1.6, color: '#cbd5e1', fontSize: 14 }}>
            <div>
              <strong style={{ color: '#e5e7eb' }}>Business:</strong> TurnQA
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: '#e5e7eb' }}>Email:</strong>{' '}
              <a
                href="mailto:support@turnqa.com"
                style={{ textDecoration: 'underline', color: '#cbd5e1' }}
              >
                support@turnqa.com
              </a>
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: '#e5e7eb' }}>Location:</strong> United States
            </div>
          </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: '#e5e7eb' }}>Mailing address:</strong> 1460 Rifle Range Road, El Cerrito, CA 94530
            </div>
            <div style={{ marginTop: 6 }}>
              <strong style={{ color: '#e5e7eb' }}>Support hours:</strong> Mon–Fri, 9am–5pm PT
            </div>
          <div style={{ marginTop: 14 }}>
            <p style={{ ...ui.muted, fontSize: 12, marginBottom: 0 }}>
              For SMS assistance, please include your account email and the phone number you used.
              Reply <strong>STOP</strong> to opt out of SMS, <strong>HELP</strong> for help.
            </p>
          </div>

          <div style={{ marginTop: 14, display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href="/" style={ui.btnSecondary}>
              Back to home
            </Link>
            <Link href="/legal/sms-terms" style={ui.btnSecondary}>
              SMS Terms
            </Link>
            <Link href="/legal/privacy" style={ui.btnSecondary}>
              Privacy Policy
            </Link>
          </div>
        </div>
      </section>

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
          <Link href="/contact" style={{ textDecoration: 'underline' }}>
            Contact
          </Link>
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
