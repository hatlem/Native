import { ImageResponse } from "next/og";

// Social share image (OpenGraph / Twitter), 1200×630, in the editorial brand
// palette. Served from a path with a file extension so the locale middleware
// (which skips anything containing a dot) leaves it alone; referenced from the
// root metadata in [locale]/layout.tsx.
export const dynamic = "force-static";

const PAPER = "#EDE8DB";
const INK = "#14110C";
const INK_MUTE = "#5E5847";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          background: PAPER,
          color: INK,
          padding: "72px 80px",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 20 }}>
          <div
            style={{
              width: 64,
              height: 64,
              borderRadius: 12,
              background: INK,
              color: PAPER,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 44,
              fontWeight: 700,
            }}
          >
            N
          </div>
          <div style={{ fontSize: 40, fontWeight: 700, letterSpacing: -1 }}>NativeSpin</div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 24 }}>
          <div style={{ fontSize: 84, fontWeight: 700, lineHeight: 1.05, letterSpacing: -3 }}>
            Native advertising in newspapers and magazines.
          </div>
          <div style={{ fontSize: 36, color: INK_MUTE }}>One catalog. One quote. One desk.</div>
        </div>
        <div style={{ display: "flex", borderTop: `2px solid ${INK}`, paddingTop: 24, fontSize: 28, color: INK_MUTE }}>
          nativespin.com
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
