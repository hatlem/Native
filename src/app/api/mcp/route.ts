import { NextRequest, NextResponse } from "next/server";
import { WebStandardStreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js";
import { buildMcpServerForToken } from "@/lib/mcp/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

function extractToken(req: NextRequest): string {
  return (
    req.headers.get("x-api-key") ??
    req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ??
    ""
  );
}

async function handle(req: NextRequest): Promise<Response> {
  const token = extractToken(req);
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
