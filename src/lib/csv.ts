// RFC 4180 CSV serializer. Used by the desk's accounting export and the
// per-org GDPR export. No deps.

export function csvCell(value: unknown): string {
  if (value == null) return "";
  const s = value instanceof Date ? value.toISOString() : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

export function csv(rows: Array<Record<string, unknown>>, headers?: string[]): string {
  if (rows.length === 0 && !headers) return "";
  const cols = headers ?? Object.keys(rows[0]);
  const head = cols.map(csvCell).join(",");
  const body = rows.map((r) => cols.map((c) => csvCell(r[c])).join(",")).join("\n");
  return `${head}\n${body}`;
}
