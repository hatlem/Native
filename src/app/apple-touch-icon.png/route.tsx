import { ImageResponse } from "next/og";

// 180×180 home-screen icon, matching src/app/icon.svg (white mark on ink).
export const dynamic = "force-static";

export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "#0a0a0a",
          color: "#ffffff",
          fontSize: 120,
          fontWeight: 700,
          fontFamily: "sans-serif",
        }}
      >
        N
      </div>
    ),
    { width: 180, height: 180 },
  );
}
