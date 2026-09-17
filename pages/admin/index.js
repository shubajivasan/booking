import dynamic from 'next/dynamic';
import Head from 'next/head';

const AdminDashboard = dynamic(() => import('../../components/AdminDashboard'), { ssr: false });

export async function getServerSideProps({ req }) {
  const cookieHeader = req.headers.cookie || '';
  const match = cookieHeader.match(/admin_session=([^;]+)/);
  const sessionValue = match ? match[1] : null;
  const expected = process.env.ADMIN_SESSION_SECRET;

  if (!expected || sessionValue !== expected) {
    return { redirect: { destination: '/admin/login', permanent: false } };
  }
  return { props: {} };
}

export default function AdminPage() {
  return (
    <>
      <Head>
        <title>Schedule dashboard — Ajivasan Academy</title>
      </Head>
      <AdminDashboard />
    </>
  );
}
