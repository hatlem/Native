'use client';

import {
  ArtifactViewer,
  type PublicPayload,
  type RespondInput,
  type RespondResult,
} from '@getplatform/artifact-viewer';

import { nativespinTheme } from './nativespin-theme';

interface Props {
  payload: PublicPayload;
  onRespond: (input: RespondInput) => Promise<RespondResult>;
  onSignInitiate: (
    provider: 'bankid' | 'vipps',
    signerEmail: string
  ) => Promise<{ signingUrl?: string; error?: string }>;
  onPayInitiate: (
    method: 'stripe' | 'vipps' | 'fiken',
    signerEmail: string
  ) => Promise<{ hostedUrl?: string; error?: string }>;
}

export function ArtifactViewerClient({ payload, onRespond, onSignInitiate, onPayInitiate }: Props) {
  return (
    <ArtifactViewer
      payload={payload}
      theme={nativespinTheme}
      onRespond={onRespond}
      onSignInitiate={onSignInitiate}
      onPayInitiate={onPayInitiate}
    />
  );
}
