// ...imports you already have
import { supabaseBrowser } from '@/lib/supabaseBrowser';

// inside your component:
const [magicSending, setMagicSending] = useState(false);

async function sendMagicLink(e: React.MouseEvent) {
  e.preventDefault();
  setMsg(null);

  if (!email) {
    setMsg('Enter your email first to receive a magic link.');
    return;
  }

  setMagicSending(true);
  try {
    const base = (
      typeof window !== 'undefined'
        ? window.location.origin
        : (process.env.NEXT_PUBLIC_BASE_URL || process.env.NEXT_PUBLIC_APP_BASE_URL || 'https://www.turnqa.com')
    ).replace(/\/+$/, '');

    const supabase = supabaseBrowser();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        emailRedirectTo: `${base}/auth/callback?next=/dashboard`
      }
    });

    if (error) setMsg(error.message);
    else setMsg('Check your email—click the link to finish sign-in.');
  } catch (err: any) {
    setMsg(err.message || 'Could not send magic link.');
  } finally {
    setMagicSending(false);
  }
}
