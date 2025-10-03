// pages/_app.tsx
import '../styles/globals.css';
import type { AppProps } from 'next/app';
import Head from 'next/head';

// -------- BEGIN TEMP PROBE (remove after we fix the caller) --------
// We patch fetch very early, on the client only.
if (typeof window !== 'undefined') {
  const origFetch = window.fetch.bind(window);

  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : (input as Request)?.url ?? (input as URL)?.toString();

      if (typeof url === 'string' && url.includes('/rest/v1/properties')) {
        // Patch both plain and URL-encoded commas after eq
        const fixed = url
          .replace(/id=eq,/g, 'id=eq.')
          .replace(/id=eq%2C/g, 'id=eq.');

        if (fixed !== url) {
          // Log the before/after and the call stack so we can find the real source file
          console.groupCollapsed('[fix] Patched "id=eq," → "id=eq." in REST URL');
          console.log('Before:', url);
          console.log('After :', fixed);
          console.log('Caller stack (open this):');
          console.trace();
          console.groupEnd();

          input =
            typeof input === 'string'
              ? fixed
              : new Request(fixed, input as RequestInit);
        }
      }
    } catch {
      // ignore
    }
    return origFetch(input as any, init);
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
