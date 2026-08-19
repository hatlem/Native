"use client";

import { useRouter, useSearchParams, usePathname } from "next/navigation";
import { useState } from "react";

// Clicks that do a SAME-ROUTE searchParams change via router.replace — the
// exact soft-nav that 503s ("router state header could not be parsed") on
// Next 15 force-dynamic pages in prod. If Next 16 fixes it, #n-value updates
// in place with no error and no full reload.
export function SoftNavProbe({ current }: { current: string }) {
  const router = useRouter();
  const sp = useSearchParams();
  const pathname = usePathname();
  const [log, setLog] = useState<string>("(no soft-nav yet)");

  function bump() {
    const next = String(Number(current) + 1);
    const q = new URLSearchParams(sp.toString());
    q.set("n", next);
    setLog(`router.replace → ?n=${next} at ${new Date().toISOString()}`);
    router.replace(`${pathname}?${q.toString()}`);
  }

  return (
    <div>
      <button id="softnav-btn" onClick={bump} style={{ padding: "8px 16px", fontSize: 16 }}>
        router.replace n+1 (soft nav)
      </button>
      <p id="softnav-log" style={{ marginTop: 12, color: "#555" }}>{log}</p>
    </div>
  );
}
