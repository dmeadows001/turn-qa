// pages/onboard/manager.js
// Retired legacy onboarding route. Use authenticated manager verification.

export async function getServerSideProps() {
  return {
    redirect: {
      destination: '/onboard/manager/phone',
      permanent: false,
    },
  };
}

export default function ManagerOnboard() {
  return null;
}
