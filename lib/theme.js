// lib/theme.js
export const midnight = {
  // palette
  bg: '#0b0b0f',
  text: '#e5e7eb',
  cardBg: '#0f172a',
  cardBorder: '#1f2937',
  fieldBg: '#111827',
  fieldBorder: '#334155',
  accentBorder: '#38bdf8', // sky-400
  accentBg: '#0ea5e9',     // sky-500
  muted: '#9ca3af',
  subtle: '#6b7280',
};

export const ui = {
  page: {
    minHeight: '100vh',
    background: midnight.bg,
    color: midnight.text,
    fontFamily: 'ui-sans-serif',
    padding: '32px 16px',
  },
  wrap: (max = 1040) => ({ maxWidth: max, margin: '0 auto' }),
  header: { textAlign: 'center', marginBottom: 18 },
  title: { fontSize: 36, fontWeight: 800, letterSpacing: '-0.02em' },

  card: {
    background: midnight.cardBg,
    border: `1px solid ${midnight.cardBorder}`,
    borderRadius: 16,
    padding: 20,
    maxWidth: '100%',
    overflow: 'hidden',
    boxShadow: '0 6px 20px rgba(0,0,0,0.25)',
  },

  sectionGrid: { display: 'grid', gap: 16, gridTemplateColumns: '1fr' },
  label: { fontSize: 13, color: midnight.muted, marginBottom: 6, display: 'block' },

  sectionTitle: {
    fontSize: 13,
    color: '#93c5fd', // soft blue accent
    marginBottom: 8,
    letterSpacing: 0.2,
    textTransform: 'uppercase',
  },

  row: { display: 'flex', gap: 8, flexWrap: 'wrap' },

  input: {
    display: 'block',
    width: '100%',
    maxWidth: '100%',
    minWidth: 0,
    boxSizing: 'border-box',
    padding: '12px 14px',
    borderRadius: 12,
    border: `1px solid ${midnight.fieldBorder}`,
    background: midnight.fieldBg,
    color: midnight.text,
    outline: 'none',
  },

  // Select styled to match input
  select: {
    display: 'block',
    width: '100%',
    boxSizing: 'border-box',
    padding: '12px 14px',
    borderRadius: 12,
    border: `1px solid ${midnight.fieldBorder}`,
    background: midnight.fieldBg,
    color: midnight.text,
    outline: 'none',
    appearance: 'none',
  },

  // Primary/secondary buttons (existing)
  btnPrimary: {
    padding: '12px 16px',
    borderRadius: 12,
    border: `1px solid ${midnight.accentBorder}`,
    background: midnight.accentBg,
    color: midnight.bg,
    textDecoration: 'none',
    fontWeight: 700,
    cursor: 'pointer',
    boxSizing: 'border-box',
  },
  btnSecondary: {
    padding: '10px 14px',
    borderRadius: 10,
    border: `1px solid ${midnight.fieldBorder}`,
    background: midnight.fieldBg,
    color: midnight.text,
    textDecoration: 'none',
    fontWeight: 600,
    boxSizing: 'border-box',
  },

  // Convenience alias so pages can use ui.button
  button: {
    padding: '12px 16px',
    borderRadius: 12,
    border: `1px solid ${midnight.accentBorder}`,
    background: midnight.accentBg,
    color: midnight.bg,
    fontWeight: 700,
    cursor: 'pointer',
    boxSizing: 'border-box',
  },

  muted: { color: midnight.muted },
  subtle: { color: midnight.subtle, fontSize: 13 },

  // Helpful message styles
  hint: { marginTop: 8, fontSize: 13, color: midnight.muted },
  ok: {
    marginTop: 8,
    border: `1px solid ${midnight.cardBorder}`,
    background: midnight.cardBg,
    borderRadius: 12,
    padding: '10px 12px',
    color: '#a7f3d0', // success green
  },

  tabs: { display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' },
  tab: (active) => ({
    flex: 1,
    textAlign: 'center',
    padding: '10px 12px',
    borderRadius: 10,
    cursor: 'pointer',
    fontWeight: 700,
    border: active ? `1px solid ${midnight.accentBorder}` : `1px solid ${midnight.fieldBorder}`,
    background: active ? midnight.accentBg : midnight.fieldBg,
    color: active ? midnight.bg : midnight.text,
    boxSizing: 'border-box',
    minWidth: 120,
  }),
};
