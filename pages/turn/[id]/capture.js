// pages/turn/[id]/capture.js
import { useRouter } from 'next/router';
import { useEffect } from 'react';

export default function LegacyCaptureRedirect() {
  const router = useRouter();
  useEffect(() => {
    if (router.query?.id) {
      router.replace(`/turns/${router.query.id}/capture`);
    }
  }, [router.query?.id]);
  return <div style={{ padding: 24, fontFamily: 'ui-sans-serif' }}>Redirecting…</div>;
}
