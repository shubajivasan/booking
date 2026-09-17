import dynamic from 'next/dynamic';
import Head from 'next/head';

// The booking app works with "today" and the next 7 days, which must be
// computed in the browser (not on the server) or the date shown on first
// load could be a day stale depending on server/visitor time zones. Loading
// it client-only avoids that mismatch entirely.
const BookingApp = dynamic(() => import('../components/BookingApp'), { ssr: false });

export default function Home() {
  return (
    <>
      <Head>
        <title>Ajivasan Academy of Performing Arts — Rooms &amp; Halls</title>
        <meta name="description" content="Book a studio, hall or classroom at Ajivasan Academy of Performing Arts." />
      </Head>
      <BookingApp />
    </>
  );
}
