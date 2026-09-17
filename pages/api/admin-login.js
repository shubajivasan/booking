// Deliberately simple, single-shared-password auth — enough to keep the
// schedule dashboard off Google and out of random hands, without building a
// full user-account system for a handful of staff members. If you need
// per-staff logins later, this is the file to replace with something like
// Supabase Auth.

export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  const { password } = req.body || {};
  const expected = process.env.ADMIN_PASSWORD;
  const secret = process.env.ADMIN_SESSION_SECRET;

  if (!expected || !secret) {
    return res.status(500).json({ error: 'Admin login is not configured on the server yet.' });
  }

  if (password !== expected) {
    return res.status(401).json({ error: 'Wrong password' });
  }

  // The cookie's value is a secret only the server knows, set only after a
  // correct password — the browser can't read or forge it (httpOnly), and a
  // guesser can't produce it without already knowing ADMIN_SESSION_SECRET.
  res.setHeader(
    'Set-Cookie',
    `admin_session=${secret}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );
  res.status(200).json({ ok: true });
}
