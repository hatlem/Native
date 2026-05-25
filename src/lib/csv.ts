// RFC 4180 CSV serializer. Used by the desk's accounting export and the
// per-org GDPR export. No deps.

// Leading characters Excel/Sheets/Numbers interpret as formula triggers.
// A row like `org_name = "=cmd|'/c calc'!A1"` would otherwise execute when
// a finance user opens the export — see OWASP CSV Injection.
const FORMULA_PREFIXES = new Set(["=", "+", "-", "@", "\t", "\r"]);

export function csvCell(value: unknown): string {
  if (value == null) return "";
  let s = value instanceof Date ? value.toISOString() : String(value);
  if (s.length > 0 && FORMULA_PREFIXES.has(s[0])) {
    s = `'${s}`;
  }
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
