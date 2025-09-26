// pages/managers/login.js
export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/managers/turns',
      permanent: false,
    },
  };
}

export default function ManagerLoginRedirect() {
  return null; // SSR redirect; nothing renders
}
