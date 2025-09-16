// pages/properties/[id]/template.js
import { useRouter } from 'next/router';

export default function TemplatePlaceholder() {
  const { id } = useRouter().query;
  const wrap = { maxWidth: 720, margin: '40px auto', padding: '0 16px', fontFamily: 'ui-sans-serif' };
  const card = { border:'1px solid #e5e7eb', borderRadius:12, padding:16, background:'#fff' };

  return (
    <main style={wrap}>
      <h1>Property Template</h1>
      <div style={card}>
        <p>Property: <code>{id || '(loading…)'} </code></p>
        <p>This is a placeholder. Next, we’ll add a simple template builder so you can define the photo checklist for cleaners (e.g., “Kitchen sink”, “Living room overview”, “Linen closet”).</p>
        <p>For now, head back to the dashboard or invite your cleaner.</p>
        <p style={{marginTop:12}}><a href={`/properties/${id}/invite`}>Invite a cleaner →</a></p>
        <p><a href="/dashboard">← Back to dashboard</a></p>
      </div>
    </main>
  );
}
