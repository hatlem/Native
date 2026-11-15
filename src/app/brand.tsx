// NativeSpin wordmark + favicon mark. Both are vector traces of the
// source design (Downloads/nativespin.png) via the project-standard
// potrace pipeline (see /Users/andreashatlem/Desktop/attorly/
// convert-v3.sh). Themed via currentColor so they inherit color from
// the container.
//
// Wordmark: 1353:254 (~5.33:1).
// N mark: 178:198 (~0.9:1, suitable for the favicon tile).
//
// Static copies mirrored at:
//   public/brand/nativespin-wordmark.svg (the wordmark is drawn from it)
//   public/brand/nativespin-n.svg

import type { SVGProps } from "react";

type WordmarkProps = SVGProps<SVGSVGElement> & { title?: string };

// The path (4 KB) is not inlined: the wordmark sits in the header and the
// footer of every page, and inline it was ~16 KB of each page's HTML and RSC
// payload. <use> draws it from the static copy, which the browser caches
// (next.config.ts) — fill stays currentColor, so it still inherits the
// container's color. Bump WORDMARK_VERSION when the file changes.
const WORDMARK_VERSION = "1";
export const WORDMARK_HREF = `/brand/nativespin-wordmark.svg?v=${WORDMARK_VERSION}#wordmark`;

export function BrandWordmark({ title = "NativeSpin", ...rest }: WordmarkProps) {
  return (
    <svg
      viewBox="0 0 1353 254"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      preserveAspectRatio="xMidYMid meet"
      {...rest}
    >
      <use href={WORDMARK_HREF} />
    </svg>
  );
}

type MarkProps = SVGProps<SVGSVGElement> & { title?: string };

const N_PATH =
  "M10 1150 l0 -820 120 0 120 0 -2 655 c-2 360 -1 655 2 655 3 -1 51 -60 107 -133 56 -73 247 -319 425 -548 178 -228 416 -537 531 -685 l207 -270 123 3 122 2 3 981 2 980 -110 0 -110 0 0 -815 c0 -448 -3 -815 -7 -814 -5 0 -26 24 -48 52 -127 167 -690 896 -934 1210 l-285 367 -133 0 -133 0 0 -820z M10 100 l0 -90 110 0 c61 0 113 -1 118 -2 4 -2 8 39 10 90 l3 92 -121 0 -120 0 0 -90z";

// Square favicon — black rounded tile with the NativeSpin 'N' glyph
// (vector-traced from the source) in white. The N's source bbox is
// 178×198. Transform maps potrace coords (10× Y-flipped) onto the
// 64×64 tile: scale 0.02222 (height-limited fit), centered horizontally
// at x=12.25 with ~10px top/bottom padding.
export function BrandMark({ title = "NativeSpin", ...rest }: MarkProps) {
  return (
    <svg
      viewBox="0 0 64 64"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      {...rest}
    >
      <rect width="64" height="64" rx="12" fill="currentColor" />
      <g transform="translate(12.25, 54) scale(0.02222, -0.02222)" fill="#fff">
        <path d={N_PATH} />
      </g>
    </svg>
  );
}
