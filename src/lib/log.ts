// Structured logging. One JSON object per line on stdout/stderr so Railway's
// log search can filter on `event`, `level` and `requestId` instead of
// free-text grepping. No dependencies and no Node-only imports: this module is
// reachable from the edge compile of instrumentation.ts.
//
//   log.error("billing.invoice_issue_failed", { orderId, err });
//   const rl = await requestLog(); rl.info("auth.signin_ok", { userId });
//
// `event` is a stable dotted name (area.what_happened). Never put secrets,
// tokens or message bodies in `fields`; ids are fine.
//
// Errors additionally go to ERROR_WEBHOOK_URL when it is set (a Slack/Discord
// compatible incoming webhook), rate-limited, so a failure reaches a human
// without anyone having to read the logs.

export type LogLevel = "debug" | "info" | "warn" | "error";
export type LogFields = Record<string, unknown>;

const REDACT = /pass(word)?|secret|token|authorization|cookie|api[-_]?key/i;

function serializeError(err: unknown): unknown {
  if (err instanceof Error) {
    const out: Record<string, unknown> = { name: err.name, message: err.message };
    if (err.stack) out.stack = err.stack.split("\n").slice(0, 12).join("\n");
    const code = (err as { code?: unknown }).code;
    if (code !== undefined) out.code = code;
    const digest = (err as { digest?: unknown }).digest;
    if (digest !== undefined) out.digest = digest;
    return out;
  }
  return err;
}

// Exported for tests: the exact record that is written.
export function buildRecord(
  level: LogLevel,
  event: string,
  fields: LogFields = {},
  now: Date = new Date(),
): Record<string, unknown> {
  const rec: Record<string, unknown> = { ts: now.toISOString(), level, event };
  for (const [k, v] of Object.entries(fields)) {
    if (v === undefined) continue;
    if (REDACT.test(k)) {
      rec[k] = "[redacted]";
    } else if (k === "err" || k === "error" || v instanceof Error) {
      rec[k] = serializeError(v);
    } else {
      rec[k] = v;
    }
  }
  return rec;
}

function safeStringify(rec: Record<string, unknown>): string {
  try {
    return JSON.stringify(rec);
  } catch {
    // Circular or BigInt payload: keep the line, drop the offending fields.
    return JSON.stringify({ ts: rec.ts, level: rec.level, event: rec.event, logError: "unserializable fields" });
  }
}

// ---- Alerting --------------------------------------------------------------

const ALERT_WINDOW_MS = 5 * 60_000;
const ALERT_MAX_PER_WINDOW = 5;
const ALERT_TIMEOUT_MS = 3000;
const alertState = { windowStart: 0, sent: 0, suppressed: 0 };
const lastByEvent = new Map<string, number>();

// Exported for tests. True when an alert for `event` may go out now: at most
// one per event per window and ALERT_MAX_PER_WINDOW in total, so an error
// storm cannot turn into a webhook storm.
export function shouldAlert(event: string, nowMs: number = Date.now()): boolean {
  if (nowMs - alertState.windowStart >= ALERT_WINDOW_MS) {
    alertState.windowStart = nowMs;
    alertState.sent = 0;
    alertState.suppressed = 0;
    lastByEvent.clear();
  }
  const last = lastByEvent.get(event);
  if (last !== undefined && nowMs - last < ALERT_WINDOW_MS) {
    alertState.suppressed++;
    return false;
  }
  if (alertState.sent >= ALERT_MAX_PER_WINDOW) {
    alertState.suppressed++;
    return false;
  }
  alertState.sent++;
  lastByEvent.set(event, nowMs);
  return true;
}

export function resetAlertStateForTests(): void {
  alertState.windowStart = 0;
  alertState.sent = 0;
  alertState.suppressed = 0;
  lastByEvent.clear();
}

function sendAlert(rec: Record<string, unknown>): void {
  const url = process.env.ERROR_WEBHOOK_URL;
  if (!url || typeof fetch !== "function") return;
  const event = String(rec.event);
  if (!shouldAlert(event)) return;
  const err = rec.err ?? rec.error;
  const message =
    err && typeof err === "object" && "message" in err
      ? String((err as { message: unknown }).message)
      : "";
  const text = [
    `[${process.env.NEXT_PUBLIC_APP_NAME || "NativeSpin"}] ${event}`,
    message && message.slice(0, 300),
    rec.requestId ? `requestId=${rec.requestId}` : "",
    rec.path ? `path=${rec.path}` : "",
  ]
    .filter(Boolean)
    .join(" · ");
  // `text` is what Slack reads, `content` what Discord reads.
  void fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text, content: text }),
    signal: AbortSignal.timeout(ALERT_TIMEOUT_MS),
  }).catch(() => {
    /* alerting must never throw into the caller */
  });
}

// ---- Logger ----------------------------------------------------------------

function write(level: LogLevel, event: string, fields?: LogFields): void {
  const rec = buildRecord(level, event, fields);
  const line = safeStringify(rec);
  if (level === "error") {
    console.error(line);
    sendAlert(rec);
  } else if (level === "warn") {
    console.warn(line);
  } else {
    console.log(line);
  }
}

export type Logger = {
  debug: (event: string, fields?: LogFields) => void;
  info: (event: string, fields?: LogFields) => void;
  warn: (event: string, fields?: LogFields) => void;
  error: (event: string, fields?: LogFields) => void;
  child: (bound: LogFields) => Logger;
};

function make(bound: LogFields): Logger {
  const w = (level: LogLevel) => (event: string, fields?: LogFields) =>
    write(level, event, { ...bound, ...fields });
  return {
    debug: w("debug"),
    info: w("info"),
    warn: w("warn"),
    error: w("error"),
    child: (more) => make({ ...bound, ...more }),
  };
}

export const log: Logger = make({});

export const REQUEST_ID_HEADER = "x-request-id";
