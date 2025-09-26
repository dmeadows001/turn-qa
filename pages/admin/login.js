// pages/admin/login.js
export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/managers/turns',
      permanent: false,
    },
  };
}
export default function LoginRedirect() {
  return null; // never renders because we redirect on the server
}
