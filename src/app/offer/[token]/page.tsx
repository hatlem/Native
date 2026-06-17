import type { PublicPayload, RespondInput } from '@getplatform/artifact-viewer';

import { ArtifactViewerClient } from './ArtifactViewerClient';
import { payInitiateAction } from './payInitiateAction';
import { respondAction } from './respondAction';
import { signInitiateAction } from './signInitiateAction';

export const dynamic = 'force-dynamic';

const BASE = process.env.GETPLATFORM_URL || 'https://get-platform-production.up.railway.app';

async function fetchPayload(token: string): Promise<PublicPayload | null> {
  try {
    const res = await fetch(`${BASE}/api/artifacts/public/${encodeURIComponent(token)}`, {
      cache: 'no-store',
    });
    if (!res.ok) return null;
    return (await res.json()) as PublicPayload;
  } catch {
    return null;
  }
}

export default async function TilbudPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const payload = await fetchPayload(token);

  if (!payload) {
    return (
      <div style={{ maxWidth: 880, margin: '0 auto', padding: 24 }}>
        <p>Could not load the document. Please try again later.</p>
      </div>
    );
  }

  async function onRespond(input: RespondInput) {
    'use server';
    return respondAction(token, input);
  }

  async function onSignInitiate(provider: 'bankid' | 'vipps', signerEmail: string) {
    'use server';
    return signInitiateAction(token, provider, signerEmail);
  }

  async function onPayInitiate(method: 'stripe' | 'vipps' | 'fiken', signerEmail: string) {
    'use server';
    return payInitiateAction(token, method, signerEmail);
  }

  return (
    <ArtifactViewerClient
      payload={payload}
      onRespond={onRespond}
      onSignInitiate={onSignInitiate}
      onPayInitiate={onPayInitiate}
    />
  );
}
