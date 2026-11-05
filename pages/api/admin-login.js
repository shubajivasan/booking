import { supabaseAdmin } from '../../lib/supabaseAdmin';
import { verifyPassword } from '../../lib/passwordHash';
import { createSessionToken } from '../../lib/sessionToken';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).end();

  // "login" is an email or a login ID (older pages send it as "email").
  const login = String(req.body?.login ?? req.body?.email ?? '').trim().toLowerCase();
  const password = req.body?.password;
  if (!login || !password) {
    return res.status(400).json({ error: 'Login ID (or email) and password are required' });
  }

  let user = null;
  let error = null;
  if (login.includes('@')) {
    ({ data: user, error } = await supabaseAdmin.from('staff_users').select('*').eq('email', login).maybeSingle());
  } else {
    // Login IDs are saved in lowercase (see pages/api/admin/staff.js).
    ({ data: user, error } = await supabaseAdmin.from('staff_users').select('*').eq('login_id', login).maybeSingle());
    if (error && /login_id/.test(error.message || '')) { user = null; error = null; } // not set up yet
  }

  if (error) return res.status(500).json({ error: 'Something went wrong. Please try again.' });

  // Deliberately the same error message whether the email doesn't exist or
  // the password is wrong — doesn't tell a guesser which one they got right.
  if (!user || !verifyPassword(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong login ID / email or password' });
  }

  const token = createSessionToken(user.id);
  res.setHeader(
    'Set-Cookie',
    `admin_session=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${60 * 60 * 24 * 30}${
      process.env.NODE_ENV === 'production' ? '; Secure' : ''
    }`
  );
  res.status(200).json({ ok: true, name: user.name });
}
