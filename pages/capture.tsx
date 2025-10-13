// pages/capture.tsx
import type { GetServerSideProps } from 'next';

export const getServerSideProps: GetServerSideProps = async ({ query }) => {
  const turn = typeof query.turn === 'string' ? query.turn : '';
  const tab  = typeof query.tab  === 'string' ? query.tab  : 'capture';
  if (!turn) {
    return { notFound: true };
  }
  return {
    redirect: {
      destination: `/turns/${encodeURIComponent(turn)}/capture?tab=${encodeURIComponent(tab)}`,
      permanent: false,
    },
  };
};

export default function CaptureRedirect() { return null; }
