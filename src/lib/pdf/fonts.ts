import path from "node:path";
import { Font } from "@react-pdf/renderer";

// react-pdf's built-in Helvetica has no Nordic glyphs (æ/ø/å, etc.) — every
// customer document must render Norwegian text correctly, so we register a
// real Unicode font instead of leaving that to the default. Self-hosted from
// public/fonts/ rather than fetched from Google's CDN at render time —
// gstatic's per-version file hashes rotate and go stale (the original
// hardcoded v13 URL 404'd in production), so PDF generation must not depend
// on a live external fetch succeeding.
//
// Only Regular and Bold are registered: react-pdf throws on an unregistered
// italic, so templates must never set fontStyle.
const FONTS_DIR = path.join(process.cwd(), "public", "fonts");
Font.register({
  family: "Inter",
  fonts: [
    { src: path.join(FONTS_DIR, "Inter-Regular.ttf") },
    {
      src: path.join(FONTS_DIR, "Inter-Bold.ttf"),
      fontWeight: 700,
    },
  ],
});

// react-pdf hyphenates with English rules, which split Nordic words at random
// ("ar-tikkel") in narrow table cells. Break lines between words only. Global
// to react-pdf, so it is set here, once, for every document.
Font.registerHyphenationCallback((word) => [word]);

export const PDF_FONT_FAMILY = "Inter";
