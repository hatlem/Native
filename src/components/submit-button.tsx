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

// A submit button with arbitrary children (icons, markup) that still gets a
// pending state: disabled + aria-busy while the surrounding <form action>
// is in flight, so a slow network can't invite a double submit. Use
// SubmitButton when the label should also change ("Saving…").
export function PendingButton({
  children,
  disabled,
  ...rest
}: Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "type">) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      {...rest}
      disabled={pending || disabled}
      aria-busy={pending || undefined}
    >
      {children}
    </button>
  );
}
