// pages/managers/index.js
import Link from 'next/link';

function Card({ href, title, desc, emoji }) {
  return (
    <Link
      href={href}
      style={{
        display:'block',
        padding:'16px',
        border:'1px solid #e5e7eb',
        borderRadius:12,
        background:'#fff',
        color:'#0f172a',
        textDecoration:'none'
      }}
    >
      <div style={{ display:'flex', alignItems:'center', gap:12 }}>
        <div style={{ fontSize:26 }}>{emoji}</div>
        <div>
          <div style={{ fontWeight:700, fontSize:18 }}>{title}</div>
          <div style={{ color:'#475569', marginTop:4, fontSize:14 }}>{desc}</div>
        </div>
      </div>
    </Link>
  );
}

export default function ManagersHome() {
  return (
    <div style={{ minHeight:'100vh', background:'#f8fafc' }}>
      <header style={{ padding:'22px 16px', borderBottom:'1px solid #e5e7eb', background:'#ffffff' }}>
        <div style={{ maxWidth:1000, margin:'0 auto' }}>
          <h1 style={{ margin:0, fontSize:28, color:'#0f172a' }}>Managers</h1>
          <div style={{ color:'#64748b', marginTop:6 }}>
            Review submitted turns, manage properties & templates.
          </div>
        </div>
      </header>

      <main style={{ maxWidth:1000, margin:'0 auto', padding:'18px 16px' }}>
        <div style={{
          display:'grid',
          gridTemplateColumns:'repeat(auto-fit, minmax(260px, 1fr))',
          gap:16
        }}>
          <Card
            href="/managers/turns"
            title="Review Turns"
            desc="See submitted turns, open the photo review screen, approve or request fixes."
            emoji="🧹"
          />
          <Card
            href="/admin/properties"
            title="Properties"
            desc="Add/edit properties and house rules used by AI pre-check."
            emoji="🏡"
          />
          <Card
            href="/admin/templates"
            title="Templates"
            desc="Define required shots per property (areas, labels, counts)."
            emoji="📋"
          />
        </div>

        <div style={{ marginTop:24, fontSize:12, color:'#94a3b8' }}>
          Tip: You can bookmark <code>/managers/turns</code> to jump straight to today’s work.
        </div>

        <div style={{ marginTop:18 }}>
          <Link href="/" style={{ color:'#0369a1', textDecoration:'none' }}>← Back to home</Link>
        </div>
      </main>
    </div>
  );
}
