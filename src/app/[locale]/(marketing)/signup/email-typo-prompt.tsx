"use client";

import { useState, type ReactNode } from "react";

// "Did you mean name@gmail.com?" under the signup email field. The fix
// is applied in place (the field is rewritten and focused) rather than
// submitted, so the user sees the corrected address before anything is
// mailed, and pressing Enter in the form still means "Create account".
// Resubmitting the original address unchanged is the "yes, it's ours"
// answer: `confirmedDomain` tells the server not to ask again.
export function EmailTypoPrompt({
  id,
  inputId,
  suggestion,
  typedDomain,
  question,
  useLabel,
  keepHint,
}: {
  id: string;
  inputId: string;
  suggestion: string;
  typedDomain: string;
  question: ReactNode;
  useLabel: string;
  keepHint: string;
}) {
  const [applied, setApplied] = useState(false);
  if (applied) return null;

  const applySuggestion = () => {
    const input = document.getElementById(inputId);
    if (input instanceof HTMLInputElement) {
      input.value = suggestion;
      input.removeAttribute("aria-invalid");
      input.removeAttribute("aria-describedby");
      input.focus();
    }
    setApplied(true);
  };

  return (
    <div className="email-typo" id={id} role="alert">
      <p>{question}</p>
      <input type="hidden" name="confirmedDomain" value={typedDomain} />
      <button type="button" className="email-typo__use" onClick={applySuggestion}>
        {useLabel}
      </button>
      <p className="hint">{keepHint}</p>
    </div>
  );
}
