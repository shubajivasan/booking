// Signs the current admin/staff user out by clearing the session cookie.
// Same cookie name, path and flags as pages/api/admin-login.js, with
// Max-Age=0 so the browser deletes it immediately.
export default function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();
  res.setHeader(
    'Set-Cookie',
    `admin_session=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );
  res.status(200).json({ ok: true });
}
