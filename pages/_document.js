// pages/_document.js
import { Html, Head, Main, NextScript } from 'next/document';

export default function Document() {
  return (
    <Html>
      <Head>
        <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover" />
      </Head>
      <body style={{ background: '#f8fafc' }}>
        <Main />
        <NextScript />
      </body>
    </Html>
  );
}
