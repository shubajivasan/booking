import { useState } from 'react';
import { useRouter } from 'next/router';
import Head from 'next/head';

export default function AdminLogin() {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const router = useRouter();

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
      <div style={{ maxWidth: 360, margin: '4rem auto', padding: '0 1.5rem' }}>
        <p className="brand-eyebrow">Ajivasan Academy of Performing Arts</p>
        <h1 className="brand" style={{ marginBottom: '1.5rem' }}>Staff login</h1>
        <form onSubmit={handleSubmit} className="panel">
          <div className="field">
            <label htmlFor="admin-email">Email</label>
            <input
              id="admin-email"
              type="email"
              autoFocus
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
      </div>
    </>
  );
}
