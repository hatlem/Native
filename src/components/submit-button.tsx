"use client";

import { useFormStatus } from "react-dom";

type Props = {
  label: string;
  pendingLabel: string;
  className?: string;
  // Disabled for a reason other than a pending submit (e.g. nothing to send).
  disabled?: boolean;
};

export function SubmitButton({
  label,
  pendingLabel,
  className = "btn primary block",
  disabled = false,
}: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className={className}
      disabled={pending || disabled}
      aria-disabled={pending || disabled}
      aria-busy={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
