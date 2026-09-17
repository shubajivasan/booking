# Ajivasan Academy — Room & Hall Booking

A Next.js app for booking Ajivasan Academy's 15 rooms and halls, backed by
Supabase. Payments aren't wired in yet — bookings confirm immediately on
submission. See `backend-architecture-plan.md` for how Razorpay slots in
later without a rewrite.

## Setup


1. **Install dependencies**
   ```
   npm install
   ```

2. **Create a Supabase project** at [supabase.com](https://supabase.com) (free tier is enough).

3. **Run the schema** — open your project's SQL editor and paste in the
   contents of `supabase-schema.sql`. This creates the `rooms` and
   `bookings` tables, seeds your 15 real spaces, and sets up the
   `unique(room_id, date, hour)` constraint that makes double-booking
   impossible.

4. **Set your environment variables** — copy `.env.local.example` to
   `.env.local` and fill in your project's URL and anon key (found under
   Settings > API in the Supabase dashboard):
   ```
   cp .env.local.example .env.local
   ```

5. **Run it locally**
   ```
   npm run dev
   ```
   Open [http://localhost:3000](http://localhost:3000).

6. **Deploy** — push this project to a GitHub repo, then import it into
   [Vercel](https://vercel.com). Add the same two environment variables
   in the Vercel project settings. You'll get a live URL immediately;
   attach your own domain from there whenever you're ready.

## How it works

- **Availability** is checked live against Supabase every time a room or
  day is selected — no more in-memory fake data.
- **Booking** inserts one row per selected hour directly from the browser
  using the Supabase anon key. That key can only do what the row-level
  security policies in `supabase-schema.sql` allow (insert a confirmed
  booking, read bookings) — it can't be used to bypass anything.
- **Double-booking** is prevented at the database level: if two people try
  to book the same room/date/hour, the second insert is rejected outright
  by the `unique` constraint, and the app shows a clear message asking
  them to pick a different slot.
- **My bookings** reads booking IDs from `localStorage` on the visitor's
  own browser and looks them up in Supabase. This is enough for a first
  version; if you want bookings to follow a student across devices, that's
  where real authentication (e.g. Supabase Auth with email or phone OTP)
  would come in.

## Adding payments later

The insert in `components/BookingApp.js` (`handleConfirmBooking`) is
marked with a `TODO(payment)` comment showing exactly where this changes:
that direct browser insert gets replaced by a call to a new
`/api/create-order` route, which holds the slots as `pending`, creates a
Razorpay order, and only marks them `confirmed` once a signed webhook
confirms payment. See `backend-architecture-plan.md` and the earlier
`api-create-order.js` / `api-razorpay-webhook.js` starter files for the
full flow.
