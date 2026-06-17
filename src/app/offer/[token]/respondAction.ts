'use server';

import type { RespondInput, RespondResult } from '@getplatform/artifact-viewer';

const BASE = process.env.GETPLATFORM_URL || 'https://get-platform-production.up.railway.app';

export async function respondAction(token: string, input: RespondInput): Promise<RespondResult> {
  try {
    const res = await fetch(`${BASE}/api/artifacts/public/${encodeURIComponent(token)}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(input),
    });
    const data = (await res.json()) as RespondResult & { error?: unknown };
    if (!res.ok)
      return {
        ok: false,
        error: typeof data.error === 'string' ? data.error : 'Could not submit your response',
      };
    return { ok: true, status: data.status, signedAt: data.signedAt };
  } catch {
    return { ok: false, error: 'Network error — please try again' };
  }
}
