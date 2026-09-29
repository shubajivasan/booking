// Verifies a "Sign in with Google" credential (an ID token) on the server.
//
// NEXT_PUBLIC_GOOGLE_CLIENT_ID: the OAuth Client ID from Google Cloud
//   (the same value the login page uses to show the Google button).
// ALLOWED_GOOGLE_DOMAINS (optional): comma-separated email domains allowed
//   to sign in / request access. Defaults to "ajivasan.com,ajivasan.org".
//   Set it to "*" to allow any Google account.
//
// Returns { email, name } on success, or throws an Error with a message
// that's safe to show on the login page.

const DEFAULT_DOMAINS = 'ajivasan.com,ajivasan.org';

export function allowedDomains() {
  return (process.env.ALLOWED_GOOGLE_DOMAINS || DEFAULT_DOMAINS)
    .split(',').map(d => d.trim().toLowerCase()).filter(Boolean);
}

export async function verifyGoogleCredential(credential) {
  const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('Google sign-in isn’t set up yet (NEXT_PUBLIC_GOOGLE_CLIENT_ID is missing).');
  if (!credential || typeof credential !== 'string') throw new Error('Google sign-in failed. Please try again.');

  const res = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(credential)}`);
  if (!res.ok) throw new Error('Google sign-in failed. Please try again.');
  const info = await res.json();

  if (info.aud !== clientId) throw new Error('Google sign-in failed (wrong app). Please try again.');
  if (!['accounts.google.com', 'https://accounts.google.com'].includes(info.iss)) throw new Error('Google sign-in failed. Please try again.');
  if (Number(info.exp) * 1000 < Date.now()) throw new Error('Google sign-in expired. Please try again.');
  if (info.email_verified !== true && info.email_verified !== 'true') throw new Error('Your Google email isn’t verified.');

  const email = String(info.email || '').toLowerCase();
  const domain = email.split('@')[1] || '';
  const domains = allowedDomains();
  if (!domains.includes('*') && !domains.includes(domain)) {
    throw new Error(`Please sign in with your Ajivasan work account (${domains.map(d => '@' + d).join(' or ')}).`);
  }

  return { email, name: info.name || email.split('@')[0] };
}
