import { useRouter } from 'next/router';

export default function Review() {
  const { query } = useRouter();
  return (
    <div style={{ padding: 24, fontFamily: 'ui-sans-serif' }}>
      <h1>Turn {query.id} — Review</h1>
      <p>This is the review page stub.</p>
    </div>
  );
}
