-- Ajivasan Academy — booking platform schema
-- Run this in the Supabase SQL editor.

create table rooms (
  id text primary key,
  name text not null,
  type text not null,
  capacity int not null,
  price_per_hour int not null
);

insert into rooms (id, name, type, capacity, price_per_hour) values
  ('R1',  'Room No 1',  'Practice room', 12, 300),
  ('R2',  'Room No 2',  'Practice room', 12, 300),
  ('R3',  'Room No 3',  'Practice room', 12, 300),
  ('R4',  'Room No 4',  'Practice room', 12, 300),
  ('R5',  'Room No 5',  'Practice room', 15, 350),
  ('R6',  'Room No 6',  'Practice room', 15, 350),
  ('R7',  'Room No 7',  'Practice room', 15, 350),
  ('R8',  'Room No 8',  'Practice room', 18, 400),
  ('R9',  'Room No 9',  'Practice room', 18, 400),
  ('R10', 'Room No 10', 'Practice room', 18, 400),
  ('BH',  'Basement Hall',   'Multi-purpose hall', 80, 1200),
  ('GTR', 'Guitar Room',     'Instrument room', 8, 350),
  ('KEY', 'Keyboard Room',   'Instrument room', 8, 350),
  ('DRM', 'Drum Room',       'Instrument room', 6, 400),
  ('MLB', 'Music Lab Room',  'Recording and production lab', 10, 500);

create table bookings (
  id uuid primary key default gen_random_uuid(),
  room_id text not null references rooms(id),
  date date not null,
  hour int not null check (hour between 9 and 20),
  student_name text not null,
  email text not null,
  phone text,
  purpose text,
  amount int not null,
  razorpay_order_id text,
  razorpay_payment_id text,
  status text not null default 'pending' check (status in ('pending','confirmed','cancelled')),
  created_at timestamptz not null default now(),

  -- This single line is what makes double-booking impossible at the database level.
  -- Two requests for the same room + date + hour cannot both succeed, no matter how
  -- close together they arrive.
  unique (room_id, date, hour)
);

create index bookings_room_date_idx on bookings (room_id, date);

-- Row-level security: students can create bookings and read them,
-- but cannot edit or delete other people's bookings from the browser.
alter table bookings enable row level security;

-- Payment isn't wired in yet, so bookings are inserted as 'confirmed'
-- directly from the browser. The unique(room_id, date, hour) constraint
-- above is still what prevents two people booking the same slot — this
-- policy just controls which status values a public insert may use.
-- When Razorpay is added later, change this to `status = 'pending'` and
-- move the insert into a server-side API route (see backend-architecture-plan.md).
create policy "Anyone can insert a confirmed booking"
  on bookings for insert
  with check (status = 'confirmed');

create policy "Anyone can read bookings"
  on bookings for select
  using (true); -- tighten this once you add real auth, if you want bookings to be private per student
