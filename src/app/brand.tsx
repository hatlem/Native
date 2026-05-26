// NativeSpin wordmark + favicon mark.
//
// This is a TEXT-BASED PLACEHOLDER until finished NativeSpin artwork is
// available. When that artwork arrives (e.g. ~/Downloads/nativespin-ferdig.png),
// regenerate via the project-standard potrace pipeline — see
// /Users/andreashatlem/Desktop/attorly/convert-v3.sh for the exact recipe:
//
//   magick nativespin-ferdig.png -fuzz 15% -flatten \
//          -background white -colorspace gray -threshold 60% /tmp/x.pbm
//   potrace /tmp/x.pbm --svg --flat --turdsize 4 --alphamax 1.0 \
//          --opttolerance 0.2 -o /tmp/x.svg
//
// Then paste the resulting <path d> into a WORDMARK_PATH constant below
// and switch BrandWordmark to render that path inside a <g transform>
// (the previous ATNative trace in git history shows the exact shape).
//
// Until then the wordmark renders as SVG <text> with a Futura-like font
// stack. It inherits color via currentColor so it themes correctly in
// the nav and any other surface.

import type { SVGProps } from "react";

type WordmarkProps = SVGProps<SVGSVGElement> & { title?: string };

const WORDMARK_FONT_STACK =
  "Futura, 'Avenir Next', Avenir, 'Century Gothic', 'Trebuchet MS', 'Helvetica Neue', Arial, sans-serif";

export function BrandWordmark({ title = "NativeSpin", ...rest }: WordmarkProps) {
  return (
    <svg
      viewBox="0 0 360 60"
      xmlns="http://www.w3.org/2000/svg"
      role="img"
      aria-label={title}
      preserveAspectRatio="xMinYMid meet"
      {...rest}
    >
      <text
        x="0"
        y="44"
        fontFamily={WORDMARK_FONT_STACK}
        fontSize="44"
        fontWeight="500"
        letterSpacing="-0.5"
        fill="currentColor"
      >
        NativeSpin
      </text>
    </svg>
  );
}

type MarkProps = SVGProps<SVGSVGElement> & { title?: string };

// Square favicon — black rounded tile with a geometric "N" glyph in
// white. Used as the favicon at src/app/icon.svg.
//
// Built from straight rectangles plus one polygon for the diagonal.
// The diagonal is drawn as a parallelogram so its ends meet the
// verticals cleanly at any size.
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
      <g fill="#fff">
        {/* Left vertical */}
        <rect x="14" y="14" width="6" height="36" />
        {/* Right vertical */}
        <rect x="44" y="14" width="6" height="36" />
        {/* Diagonal beam from top-left of left bar to bottom-right of right bar */}
        <polygon points="20,14 28,14 50,50 42,50" />
      </g>
    </svg>
  );
}
