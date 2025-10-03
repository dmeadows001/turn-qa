// pages/_app.tsx
import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';

// -------- BEGIN TEMP PROBE (remove after we fix the caller) --------
if (typeof window !== 'undefined') {
  const __ORIG_FETCH = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url = typeof input === 'string'
        ? input
        : (input as Request)?.url ?? (input as URL)?.toString();

      if (typeof url === 'string'
          && url.includes('/rest/v1/properties')
          && (url.includes('id=eq,') || url.includes('id=eq%2C'))) {

        // Always show it
        console.group('[BAD REST CALL] found "=eq,"');
        console.warn('URL  :', url);

        // Try to print a readable stack
        console.warn('Caller stack (click a frame):');
        console.trace();

        // Pause here so you can click the real caller in the Call Stack
        debugger;

        // Hot-fix so page continues working meanwhile
        const fixed = url.replace(/id=eq,|id=eq%2C/g, 'id=eq.');
        input = typeof input === 'string' ? fixed : new Request(fixed, input as RequestInit);
        console.warn('Fixed:', fixed);
        console.groupEnd();
      }
    } catch { /* ignore */ }
    return __ORIG_FETCH(input as any, init);
  };
}
// -------- END TEMP PROBE --------


export default function App({ Component, pageProps }: AppProps) {
  return (
    <>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <title>TurnQA</title>
      </Head>
      <Component {...pageProps} />
    </>
  );
}
