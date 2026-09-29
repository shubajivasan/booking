import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

const GOOGLE_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;

export default function AdminLogin() {
  const router = useRouter();

  // ---- Sign in with Google ----
  const googleButtonRef = useRef(null);
  const credentialRef = useRef(null); // last Google credential, reused for "Request access"
  const [googleState, setGoogleState] = useState(null); // { status, email, name }
  const [googleError, setGoogleError] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);

  async function sendGoogle(request = false) {
    setGoogleBusy(true);
    setGoogleError('');
    const res = await fetch('/api/admin-google-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ credential: credentialRef.current, request }),
    });
    const body = await res.json().catch(() => ({}));
    setGoogleBusy(false);
    if (!res.ok) { setGoogleError(body.error || 'Google sign-in failed. Please try again.'); return; }
    if (body.status === 'ok') { router.push('/admin'); return; }
    setGoogleState(body);
  }

  useEffect(() => {
    if (!GOOGLE_CLIENT_ID) return;
    function init() {
      if (!window.google?.accounts?.id || !googleButtonRef.current) return;
      window.google.accounts.id.initialize({
        client_id: GOOGLE_CLIENT_ID,
        callback: response => {
          credentialRef.current = response.credential;
          sendGoogle(false);
        },
      });
      window.google.accounts.id.renderButton(googleButtonRef.current, {
        theme: 'outline', size: 'large', text: 'signin_with', shape: 'pill', width: 280,
      });
    }
    if (window.google?.accounts?.id) { init(); return; }
    const script = document.createElement('script');
    script.src = 'https://accounts.google.com/gsi/client';
    script.async = true;
    script.defer = true;
    script.onload = init;
    document.head.appendChild(script);
  }, []);

  // ---- Email + password (kept for accounts that have a password) ----
  const [showPassword, setShowPassword] = useState(!GOOGLE_CLIENT_ID);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  async function handleSubmit(e) {
    e.preventDefault();
    if (!email || !password) {
      setError('Enter your email and password');
      return;
    }
    setLoading(true);
    setError('');
    const res = await fetch('/api/admin-login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password }),
    });
    const body = await res.json().catch(() => ({}));
    setLoading(false);
    if (res.ok) {
      router.push('/admin');
    } else {
      setError(body.error || 'Wrong email or password. Try again.');
    }
  }

  return (
    <>
      <Head>
        <title>Staff login — Ajivasan Academy</title>
      </Head>
      <div style={{ maxWidth: 380, margin: '4rem auto', padding: '0 1.5rem' }}>
        <p className="brand-eyebrow">Ajivasan Academy of Performing Arts</p>
        <h1 className="brand" style={{ marginBottom: '1.5rem' }}>Staff login</h1>

        {GOOGLE_CLIENT_ID && (
          <div className="panel" style={{ textAlign: 'center' }}>
            <p style={{ fontSize: 13, color: 'var(--ink-soft)', marginTop: 0 }}>
              Sign in with your Ajivasan Google Workspace account.
            </p>
            <div ref={googleButtonRef} style={{ display: 'flex', justifyContent: 'center', minHeight: 44 }} />
            {googleBusy && <p style={{ fontSize: 13, color: 'var(--ink-soft)' }}>Checking&hellip;</p>}
            {googleError && <div className="inline-error" style={{ marginTop: 12 }}>{googleError}</div>}

            {googleState && (
              <div className="login-access-box">
                {googleState.status === 'no_access' && (
                  <>
                    <p><b>{googleState.email}</b> doesn&rsquo;t have access to the dashboard yet.</p>
                    <button className="cta" disabled={googleBusy} onClick={() => sendGoogle(true)}>Request access</button>
                  </>
                )}
                {googleState.status === 'requested' && (
                  <p>&#10003; Request sent. The super admin has been notified &mdash; you&rsquo;ll get an email at <b>{googleState.email}</b> once it&rsquo;s approved.</p>
                )}
                {googleState.status === 'pending' && (
                  <p>Your access request for <b>{googleState.email}</b> is waiting for the super admin&rsquo;s approval. You&rsquo;ll get an email once it&rsquo;s approved.</p>
                )}
                {googleState.status === 'rejected' && (
                  <>
                    <p>Your earlier request for <b>{googleState.email}</b> wasn&rsquo;t approved.</p>
                    <button className="cta ghost" disabled={googleBusy} onClick={() => sendGoogle(true)}>Request again</button>
                  </>
                )}
              </div>
            )}
          </div>
        )}

        {GOOGLE_CLIENT_ID && !showPassword && (
          <p style={{ textAlign: 'center', fontSize: 12 }}>
            <button type="button" className="link-button" onClick={() => setShowPassword(true)}>Sign in with email &amp; password instead</button>
          </p>
        )}

        {showPassword && (
          <form onSubmit={handleSubmit} className="panel">
            <div className="field">
              <label htmlFor="admin-email">Email</label>
              <input
                id="admin-email"
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@ajivasan.com"
              />
            </div>
            <div className="field">
              <label htmlFor="admin-password">Password</label>
              <input
                id="admin-password"
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="Enter your password"
              />
              {error && <div className="error-text">{error}</div>}
            </div>
            <button className="cta" type="submit" disabled={loading} style={{ width: '100%' }}>
              {loading ? 'Checking…' : 'Sign in'}
            </button>
          </form>
        )}
      </div>
    </>
  );
}
