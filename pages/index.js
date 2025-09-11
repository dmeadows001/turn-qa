// pages/index.js
import Link from 'next/link';

export default function Home() {
  return (
    <div style={{ minHeight:'100vh', display:'flex', alignItems:'center', justifyContent:'center', background:'#0f172a', color:'#e2e8f0' }}>
      <div style={{ maxWidth:960, width:'100%', padding:'40px 20px' }}>
        <div style={{ textAlign:'center', marginBottom:28 }}>
          <h1 style={{ fontSize:36, margin:0 }}>TurnQA</h1>
          <p style={{ opacity:0.85, marginTop:8, fontSize:16 }}>
            AI-powered turnover photo QA for vacation rentals
          </p>
        </div>

        <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fit,minmax(260px,1fr))', gap:16 }}>
          <Link href="/cleaners" style={{
            background:'#0284c7', color:'#fff', textDecoration:'none', padding:'18px 16px',
            borderRadius:12, textAlign:'center', fontWeight:700, fontSize:18
          }}>
            Cleaners — Start Here
          </Link>

          <Link href="/managers" style={{
            background:'#f8fafc', color:'#0f172a', textDecoration:'none', padding:'18px 16px',
            borderRadius:12, textAlign:'center', fontWeight:700, fontSize:18, border:'1px solid #e5e7eb'
          }}>
            Managers — Admin & Review
          </Link>
        </div>

        <div style={{ textAlign:'center', marginTop:18, fontSize:12, opacity:0.75 }}>
          turnqa.com
        </div>
      </div>
    </div>
  );
}
