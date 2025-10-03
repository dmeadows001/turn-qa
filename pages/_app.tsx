// pages/_app.tsx
import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';

// -------- BEGIN TEMP PROBE (remove after we fix the caller) --------
if (typeof window !== 'undefined') {
  // bind() to avoid "Illegal invocation" in some browsers
  const __ORIG_FETCH = window.fetch.bind(window);
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      const url =
        typeof input === 'string'
          ? input
          : (input as Request)?.url ?? (input as URL)?.toString();

      if (
        typeof url === 'string' &&
        url.includes('/rest/v1/properties') &&
        url.includes('id=eq,')
      ) {
        console.group('[BAD REST CALL] found "=eq,"');
        console.warn('URL:', url);
        console.warn('Caller stack:');
        console.warn(new Error().stack);
        console.groupEnd();

        // hot-fix so the page still works while we locate the caller
        const fixed = url.replace(/id=eq,/g, 'id=eq.');
        input =
          typeof input === 'string'
            ? fixed
            : new Request(fixed, input as RequestInit);
      }
    } catch {
      // swallow probe errors
    }
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
