import { loadSpaceDetails } from '../../lib/spaceDetails';

// Public: the super admin's edits to space details, for the booking page.
// Only display details (no one's personal data).
export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).end();
  const rows = await loadSpaceDetails();
  res.setHeader('Cache-Control', 'no-store');
  res.status(200).json({
    spaces: rows.map(({ id, name, code, type, capacity, price_per_hour, description }) => ({
      id, name, code, type, capacity, price_per_hour, description,
    })),
  });
}
