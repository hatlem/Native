'use server';

import { headers } from 'next/headers';

const BASE = process.env.GETPLATFORM_URL || 'https://get-platform-production.up.railway.app';

export async function signInitiateAction(
  token: string,
  provider: 'bankid' | 'vipps',
  signerEmail: string
) {
  try {
    const h = await headers();
    const host = h.get('host');
    const proto = h.get('x-forwarded-proto') || 'https';
    const returnUrl = host ? `${proto}://${host}/offer/${encodeURIComponent(token)}` : undefined;

    const res = await fetch(
      `${BASE}/api/artifacts/public/${encodeURIComponent(token)}/respond/sign-initiate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ provider, signerEmail, returnUrl }),
      }
    );
    const data = (await res.json()) as { signingUrl?: string; error?: string };
    if (!res.ok) return { error: data.error ?? 'Could not start signing' };
    return { signingUrl: data.signingUrl };
  } catch {
    return { error: 'Network error' };
  }
}
