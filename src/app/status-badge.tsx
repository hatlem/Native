import { statusTone, statusLabel } from "@/lib/status";

export function StatusBadge({ value }: { value: string }) {
  return (
    <span className={`badge badge-${statusTone(value)}`}>
      {statusLabel(value)}
    </span>
  );
}
