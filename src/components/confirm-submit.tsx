"use client";

import { useState } from "react";
import { useFormStatus } from "react-dom";

type Props = {
  label: string;
  confirmLabel: string;
  cancelLabel: string;
  pendingLabel: string;
  // Class of the first (arming) button. The confirm button is always danger.
  className?: string;
};

// Two-step submit for a destructive action inside a <form action>. The first
// click only arms it; the second (danger-styled) click submits. Mirrors the
// DeleteListButton pattern in FavoritesView so one accidental click can never
// revoke a member, delete a log entry or deactivate a title.
export function ConfirmSubmit({
  label,
  confirmLabel,
  cancelLabel,
  pendingLabel,
  className = "btn ghost small",
}: Props) {
  const [confirming, setConfirming] = useState(false);
  const { pending } = useFormStatus();
  if (!confirming) {
    return (
      <button type="button" className={className} onClick={() => setConfirming(true)}>
        {label}
      </button>
    );
  }
  return (
    <span className="cluster" style={{ gap: 4 }} role="group" aria-label={label}>
      <button
        type="submit"
        className="btn small danger"
        disabled={pending}
        aria-busy={pending || undefined}
        autoFocus
      >
        {pending ? pendingLabel : confirmLabel}
      </button>
      <button
        type="button"
        className="btn ghost small"
        disabled={pending}
        onClick={() => setConfirming(false)}
      >
        {cancelLabel}
      </button>
    </span>
  );
}
