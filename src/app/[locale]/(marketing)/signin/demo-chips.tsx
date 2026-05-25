"use client";

import { useState } from "react";

export type DemoAccount = {
  key: string;
  label: string;
  email: string;
  password: string;
};

type Props = {
  label: string;
  accounts: DemoAccount[];
};

export function DemoChips({ label, accounts }: Props) {
  const [active, setActive] = useState<string | null>(null);

  function fill(account: DemoAccount) {
    const email = document.getElementById("email") as HTMLInputElement | null;
    const pw = document.getElementById("password") as HTMLInputElement | null;
    if (email) {
      email.value = account.email;
      email.dispatchEvent(new Event("input", { bubbles: true }));
    }
    if (pw) {
      pw.value = account.password;
      pw.dispatchEvent(new Event("input", { bubbles: true }));
    }
    setActive(account.key);
    pw?.focus();
  }

  return (
    <div className="demo-block">
      <div className="label">{label}</div>
      <div className="demo-chips" role="group" aria-label={label}>
        {accounts.map((a) => (
          <button
            key={a.key}
            type="button"
            className="demo-chip"
            data-active={active === a.key ? "true" : undefined}
            onClick={() => fill(a)}
          >
            {a.label}
          </button>
        ))}
      </div>
    </div>
  );
}
