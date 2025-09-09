import { useRouter } from 'next/router';

export default function Capture() {
  const { query } = useRouter();
  return (
    <div style={{ padding: 24, fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {query.id} — Cleaner Capture</h1>
      <p>If you see this, the route is working!</p>
    </div>
  );
}
