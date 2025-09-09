import { useRouter } from 'next/router';

export default function Review() {
  const { query } = useRouter();
  return (
    <div style={{ padding: 24, fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {query.id} — Review (Coming Soon)</h1>
      <p>This page will show flagged areas, approve/override, and generate the PDF report.</p>
    </div>
  );
}

