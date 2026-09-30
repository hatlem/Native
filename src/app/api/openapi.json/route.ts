// Public OpenAPI 3.1 spec for the NativeSpin partner-program API. The spec
// itself lives in src/lib/api/openapi-spec.ts so the contract tests can
// validate live responses against it.

import { NextResponse } from "next/server";
import { OPENAPI_SPEC } from "@/lib/api/openapi-spec";

export const dynamic = "force-static";
export const revalidate = 3600; // re-render hourly; spec is rarely-changing.

export async function GET() {
  return NextResponse.json(OPENAPI_SPEC, {
    headers: {
      // Spec is public — let CDNs cache it.
      "Cache-Control": "public, max-age=3600, s-maxage=3600",
    },
  });
}
