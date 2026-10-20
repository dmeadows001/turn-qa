// components/ChromeDark.js
import Link from 'next/link';
import { ui } from '../lib/theme';
import UserMenu from './UserMenu';

export default function ChromeDark({
  title = 'TurnQA',
  children,
  max = 1040,
  showBilling = false,
}) {
  return (
    <div style={ui.page}>
      <main style={ui.wrap(max)}>
        <header
          style={{
            ...ui.header,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div style={ui.title}>{title}</div>

          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
            }}
          >
            {showBilling && (
              <Link
                href="/billing"
                style={{
                  ...ui.btnSecondary,
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  textDecoration: 'none',
                }}
              >
                <svg
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  aria-hidden="true"
                >
                  <rect x="2" y="5" width="20" height="14" rx="2" />
                  <path d="M2 10h20" />
                </svg>
                <span>Billing</span>
              </Link>
            )}

            <UserMenu />
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
