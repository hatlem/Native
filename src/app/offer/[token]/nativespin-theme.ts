import type { Theme } from '@getplatform/artifact-viewer';

// NativeSpin is an international platform: brand only, no string overrides.
// The viewer resolves language from each artifact's `locale` (English default,
// Norwegian for nb/nn/no), so we must NOT force Norwegian strings here.
//
// Colours and font are derived from the NativeSpin design system tokens in
// src/app/globals.css: --ink (#0a0b0d) is the primary brand ink, --accent
// (#4332f5) is the indigo accent, and the body type stack is Inter.
export const nativespinTheme: Theme = {
  brandColor: '#0a0b0d',
  accentColor: '#4332f5',
  fontFamily: 'Inter, system-ui, sans-serif',
};
