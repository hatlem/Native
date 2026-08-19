// Next.js instrumentation hook (stable since Next 15): register() runs once
// per server process at boot and is compiled for BOTH the Node and edge
// runtimes. The scheduling code lives in instrumentation-node.ts and is
// imported ONLY behind this statically-inlined NEXT_RUNTIME check — the
// documented pattern that lets the edge build dead-code-eliminate the import
// (its graph reaches node:crypto, which the edge bundler cannot handle).
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    const { startSchedules } = await import("./instrumentation-node");
    await startSchedules();
  }
}
