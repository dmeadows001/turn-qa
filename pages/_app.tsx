// pages/_app.tsx
import type { AppProps } from 'next/app';
import Head from 'next/head';
import '../styles/globals.css';

// -------- BEGIN TEMP PROBE (remove after we fix the caller) --------
if (typeof window !== 'undefined') {
  const __ORIG_FETCH = window.fetch;
  window.fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
    try {
      // Normalize to a string URL
      const toUrl = (x: RequestInfo | URL) =>
        typeof x === 'string'
          ? x
          : (x as Request)?.url ?? (x as URL)?.toString();

      const url = toUrl(input);

      if (
        typeof url === 'string' &&
        url.includes('/rest/v1/properties') &&
        (url.includes('id=eq,') || url.includes('id=eq%2C'))
      ) {
        console.group('[BAD REST CALL] found "=eq,"');
        console.warn('URL (bad):', url);
        console.trace('Caller stack (click a frame):');
        debugger; // DevTools will pause here if open
        const fixedUrl = url.replace(/id=eq,|id=eq%2C/g, 'id=eq.');

        // Preserve init/options (method, headers, body, etc.)
        let newInit = init;
        if (input instanceof Request) {
          newInit = {
            method: input.method,
            headers: input.headers ? new Headers(input.headers) : undefined,
            body:
              input.method !== 'GET' && input.method !== 'HEAD'
                ? await input.clone().text()
                : undefined,
            mode: input.mode,
            credentials: input.credentials,
            cache: input.cache,
            redirect: input.redirect,
            referrer: input.referrer,
            referrerPolicy: input.referrerPolicy,
            integrity: input.integrity,
            keepalive: (input as any).keepalive,
            signal: input.signal,
            ...init,
          };
        }
        console.warn('URL (fixed):', fixedUrl);
        console.groupEnd();
        return __ORIG_FETCH(fixedUrl, newInit);
      }
    } catch {
      // ignore
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
