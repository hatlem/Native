import { SoftNavProbe } from "./probe";

// THROWAWAY diagnostic (next16-experiment branch only): reproduces the exact
// condition of the prod RSC soft-nav 503 — a force-dynamic page whose client
// child does a same-route searchParams router.replace. Unauthenticated so it
// can be tested on staging without seed data. Delete before any merge.
export const dynamic = "force-dynamic";

export default async function SoftNavProbePage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const sp = await searchParams;
  const n = typeof sp.n === "string" ? sp.n : "0";
  return (
    <main style={{ padding: 40, fontFamily: "system-ui" }}>
      <h1>Soft-nav probe</h1>
      <p>
        Server-rendered n = <strong id="n-value">{n}</strong> · rendered at{" "}
        {new Date().toISOString()}
      </p>
      <SoftNavProbe current={n} />
    </main>
  );
}
