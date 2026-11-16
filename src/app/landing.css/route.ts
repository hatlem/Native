import { STYLES } from "../landing-styles";

// The editorial ("Bone") stylesheet as a real, cacheable file. It used to be
// inlined into every marketing response as a <style> block — 65 KB, three
// times over (loading shell, page, and the RSC payload). LandingShell now
// links to this route with a content hash in the query string, so a browser
// downloads it once and reuses it across pages and visits.
export const dynamic = "force-static";

export function GET() {
  return new Response(STYLES, {
    headers: {
      "Content-Type": "text/css; charset=utf-8",
      // Safe to cache forever: the URL carries the content hash (STYLES_HREF).
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}
