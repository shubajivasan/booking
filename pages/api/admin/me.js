import { getAdminUser } from '../../../lib/adminAuth';

export default async function handler(req, res) {
  const user = await getAdminUser(req);
  if (!user) return res.status(401).json({ error: 'Not signed in.' });
  res.status(200).json({ user });
}
