"use client";

import { useFormStatus } from "react-dom";

type Props = {
  label: string;
  pendingLabel: string;
};

export function SubmitButton({ label, pendingLabel }: Props) {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      className="btn primary block"
      disabled={pending}
      aria-disabled={pending}
      aria-busy={pending}
    >
      {pending ? pendingLabel : label}
    </button>
  );
}
