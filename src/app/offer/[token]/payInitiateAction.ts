'use server';

import { headers } from 'next/headers';

const BASE = process.env.GETPLATFORM_URL || 'https://get-platform-production.up.railway.app';

export async function payInitiateAction(
  token: string,
  method: 'stripe' | 'vipps' | 'fiken',
  signerEmail: string
) {
  try {
    const h = await headers();
    const host = h.get('host');
    const proto = h.get('x-forwarded-proto') || 'https';
    const returnUrl = host ? `${proto}://${host}/offer/${encodeURIComponent(token)}` : undefined;
    const res = await fetch(
      `${BASE}/api/artifacts/public/${encodeURIComponent(token)}/respond/pay-initiate`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ method, signerEmail, returnUrl }),
      }
    );
    const data = (await res.json()) as { hostedUrl?: string; error?: string };
    if (!res.ok) return { error: data.error ?? 'Could not start payment' };
    return { hostedUrl: data.hostedUrl };
  } catch {
    return { error: 'Network error' };
  }
}
