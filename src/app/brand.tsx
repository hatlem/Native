// ATNative wordmark + favicon mark, drawn as primitives so the SVG is
// font-independent and crisp at any size. Stroke-based geometric sans
// inspired by the Futura/Avenir feel of the brand artwork. Color follows
// `currentColor` so the mark inherits text color from its container —
// dark on the marketing chrome, white on a dark-mode panel, etc.
//
// The signature element is the small ladder of three dashes hanging
// below the T's baseline (publication "layers"). It's part of the
// wordmark for the nav; the favicon uses just the T+ladder mark.

import type { SVGProps } from "react";

type WordmarkProps = SVGProps<SVGSVGElement> & { title?: string };

export function BrandWordmark({ title = "ATNative", ...rest }: WordmarkProps) {
  return (
    <svg
      viewBox="0 0 460 110"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      fill="none"
      stroke="currentColor"
      strokeWidth="6"
      strokeLinecap="square"
      strokeLinejoin="miter"
      {...rest}
    >
      {/* A: triangle outline + crossbar (cap-height 70, y=15..85) */}
      <path d="M5 85 L40 15 L75 85 M22 60 L58 60" />

      {/* T: top bar + stem */}
      <path d="M85 15 L145 15 M115 18 L115 85" />

      {/* T-ladder: three dashes below the T, centered on the stem at x=115 */}
      <g stroke="none" fill="currentColor">
        <rect x="103" y="92" width="24" height="3.5" />
        <rect x="103" y="99.5" width="24" height="3.5" />
        <rect x="103" y="107" width="24" height="3.5" />
      </g>

      {/* N: two verticals + diagonal */}
      <path d="M158 85 L158 15 L210 85 L210 15" />

      {/* a — single-story: open bowl + tail. Drawn as one continuous path
         that traces the right stem down, around the bottom, and closes the
         bowl with a clockwise arc back to the top of the stem. */}
      <path d="M260 49 a18 18 0 1 0 0 26 L260 85 M260 49 L260 85" />

      {/* t: stem + crossbar (ascender, stem y=27..85) */}
      <path d="M283 32 L283 85 M272 48 L297 48" />

      {/* i: dot + stem */}
      <circle cx="313" cy="35" r="3.2" stroke="none" fill="currentColor" />
      <path d="M313 50 L313 85" />

      {/* v: two diagonals meeting at baseline */}
      <path d="M327 50 L350 85 L373 50" />

      {/* e: bowl with crossbar and open bottom-right. Drawn as a
         crossbar plus an arc that starts at the bottom-right opening,
         sweeps up and around back to the crossbar's right end. */}
      <path d="M386 67 L420 67 M420 67 a17 17 0 1 0 -7 16" />
    </svg>
  );
}

type MarkProps = SVGProps<SVGSVGElement> & { title?: string };

// Square favicon — black rounded tile with the T+ladder mark in white.
export function BrandMark({ title = "ATNative", ...rest }: MarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      {...rest}
    >
      <rect width="64" height="64" rx="12" fill="currentColor" />
      <g fill="#fff">
        {/* T top bar */}
        <rect x="14" y="18" width="36" height="4.5" />
        {/* T stem */}
        <rect x="29.75" y="22.5" width="4.5" height="22" />
        {/* Ladder */}
        <rect x="24" y="48" width="16" height="3" />
        <rect x="24" y="52.5" width="16" height="3" />
        <rect x="24" y="57" width="16" height="3" />
      </g>
    </svg>
  );
}
