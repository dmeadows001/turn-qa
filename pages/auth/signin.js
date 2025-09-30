// pages/auth/signin.js
import { useEffect } from 'react';
import { useRouter } from 'next/router';

export default function AuthSignin() {
  const router = useRouter();

  useEffect(() => {
    const mode = (router.query.mode || 'signin').toString();
    router.replace(mode === 'signup' ? '/signup' : '/login');
  }, [router]);

  return null; // no UI here; we just redirect
}
