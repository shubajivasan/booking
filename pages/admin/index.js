import dynamic from 'next/dynamic';
import Head from 'next/head';
import { isAdminAuthenticated } from '../../lib/adminAuth';

const AdminDashboard = dynamic(() => import('../../components/AdminDashboard'), { ssr: false });

export async function getServerSideProps({ req }) {
  if (!isAdminAuthenticated(req)) {
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
