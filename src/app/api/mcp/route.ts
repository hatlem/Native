import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServerForToken } from "@/lib/mcp/server";
import { rfqLimiter } from "@/lib/rate-limit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string {
  return (
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

function clientIp(req: NextRequest): string {
  return (
    req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    req.headers.get("x-real-ip") ||
    "unknown"
  );
}

async function handle(req: NextRequest): Promise<Response> {
  const token = extractToken(req);

  // Rate-limit BEFORE the DB lookup so an attacker spraying tokens at
  // the endpoint can't burn one DB round-trip per attempt. Bucket by
  // sha256(token) so the limiter key never holds the raw secret, and
  // fall back to client IP for unauthenticated probes.
  const limitKey = token
    ? `mcp:tok:${createHash("sha256").update(token).digest("hex")}`
    : `mcp:ip:${clientIp(req)}`;
  const limited = await rfqLimiter.check(limitKey);
  if (!limited.ok) {
    return NextResponse.json(
      { error: "rate_limited", retryAfterMs: limited.retryAfterMs },
      {
        status: 429,
        headers: {
          "Retry-After": String(Math.ceil(limited.retryAfterMs / 1000)),
        },
      },
    );
  }

  const server = await buildMcpServerForToken(token);
  if (!server) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  // Stateless transport: each request gets a fresh transport instance.
  // sessionIdGenerator: undefined disables session management.
  const transport = new WebStandardStreamableHTTPServerTransport({
    sessionIdGenerator: undefined,
    enableJsonResponse: true,
  });

  await server.connect(transport);

  return transport.handleRequest(req);
}

export async function POST(req: NextRequest) {
  return handle(req);
}

export async function GET(req: NextRequest) {
  return handle(req);
}

export async function DELETE(req: NextRequest) {
  return handle(req);
}
