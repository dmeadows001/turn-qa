// pages/_app.js
export default function App({ Component, pageProps }) {
  return (
    <>
      <style jsx global>{`
        *, *::before, *::after { box-sizing: border-box; }
        html, body { height: 100%; }
        body {
          margin: 0;
          background: #0b0b0f;  /* Midnight background */
          color: #e5e7eb;       /* slate-200 text */
          font-family: ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial, Apple Color Emoji, Segoe UI Emoji;
        }
        a { color: inherit; }
      `}</style>
      <Component {...pageProps} />
    </>
  );
}
