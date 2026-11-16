import { headers } from "next/headers";
import { log, REQUEST_ID_HEADER, type Logger } from "@/lib/log";

// A logger bound to the current request's correlation id (set by middleware,
// or passed through from the upstream proxy). Server-only: kept out of log.ts
// so that module stays importable from any runtime. Outside a request scope
// it falls back to the plain logger.
export async function requestLog(): Promise<Logger> {
  try {
    const id = (await headers()).get(REQUEST_ID_HEADER);
    return id ? log.child({ requestId: id }) : log;
  } catch {
    return log;
  }
}
