// Next.js instrumentation hook (stable since Next 15): register() runs once
// per server process at boot and is compiled for BOTH the Node and edge
// runtimes. The scheduling code lives in instrumentation-node.ts and is
// imported ONLY behind this statically-inlined NEXT_RUNTIME check — the
// documented pattern that lets the edge build dead-code-eliminate the import
// (its graph reaches node:crypto, which the edge bundler cannot handle).
import { log, REQUEST_ID_HEADER } from "@/lib/log";

export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSchedules } = await import("./instrumentation-node");
    await startSchedules();
  }
}

// Called by Next for every error thrown while rendering a page, running a
// route handler or a server action. Until now these only reached the default
// console output; this writes one structured line per failure (path, route,
// correlation id, digest) and, through the logger, alerts ERROR_WEBHOOK_URL.
// The digest matches the "Error ID" the error boundary shows the user.
export async function onRequestError(
  err: unknown,
  request: { path: string; method: string; headers: Record<string, string | string[] | undefined> },
  context: { routerKind: string; routePath: string; routeType: string; renderSource?: string },
): Promise<void> {
  const rid = request.headers[REQUEST_ID_HEADER];
  // A visitor navigating away mid-stream is not a failure worth an alert.
  const aborted =
    err instanceof Error &&
    (/destination stream errored|aborted|ECONNRESET|socket hang up/i.test(err.message) || err.name === "AbortError");
  log[aborted ? "info" : "error"](aborted ? "request.client_aborted" : "request.unhandled_error", {
    err,
    method: request.method,
    // Strip the query string: it can carry tokens (?token=, magic links).
    path: request.path.split("?")[0],
    route: context.routePath,
    routeType: context.routeType,
    routerKind: context.routerKind,
    renderSource: context.renderSource,
    requestId: Array.isArray(rid) ? rid[0] : rid,
  });
}
