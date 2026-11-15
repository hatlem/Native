"use client";

import { useActionState } from "react";
import {
  confirmMfaEnrolment,
  disableMfaAction,
  regenerateMfaRecoveryCodes,
  type MfaFormState,
} from "@/app/mfa-actions";
import { SubmitButton } from "@/components";

type ErrorLabels = { invalid: string; rate: string; password: string };

function errorText(state: MfaFormState, labels: ErrorLabels): string | null {
  return state.error ? labels[state.error] : null;
}

const MONO: React.CSSProperties = {
  fontFamily: "var(--font-mono, ui-monospace, monospace)",
  letterSpacing: "0.04em",
};

// The one time the recovery codes are visible. They arrive from the server
// (decrypted from a five-minute httpOnly cookie) and "I've saved them" clears
// that cookie.
function RecoveryCodes({
  codes,
  title,
  lead,
  doneLabel,
  pendingLabel,
  locale,
  doneHref,
  dismissAction,
}: {
  codes: string[];
  title: string;
  lead: string;
  doneLabel: string;
  pendingLabel: string;
  locale: string;
  doneHref: string;
  dismissAction: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <form action={dismissAction} className="product-form card">
      <input type="hidden" name="locale" value={locale} />
      <input type="hidden" name="next" value={doneHref} />
      <h3>{title}</h3>
      <p className="muted small">{lead}</p>
      <ul
        aria-label={title}
        style={{
          ...MONO,
          listStyle: "none",
          padding: 0,
          margin: "12px 0",
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(9.5rem, 1fr))",
          gap: "0.5rem 1rem",
        }}
      >
        {codes.map((c) => (
          <li key={c}>{c}</li>
        ))}
      </ul>
      <div className="actions">
        <SubmitButton label={doneLabel} pendingLabel={pendingLabel} className="btn primary" />
      </div>
    </form>
  );
}

function CodeField({ id, label, hint }: { id: string; label: string; hint?: string }) {
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        id={id}
        name="code"
        type="text"
        autoComplete="one-time-code"
        autoCapitalize="none"
        autoCorrect="off"
        spellCheck={false}
        maxLength={24}
        style={MONO}
        aria-describedby={hint ? `${id}-hint` : undefined}
      />
      {hint ? (
        <span className="hint" id={`${id}-hint`}>
          {hint}
        </span>
      ) : null}
    </div>
  );
}

function ConfirmEnrolmentForm({
  locale,
  state,
  action,
  labels,
}: {
  locale: string;
  state: MfaFormState;
  action: (formData: FormData) => void;
  labels: { code: string; submit: string; pending: string; errors: ErrorLabels };
}) {
  const err = errorText(state, labels.errors);
  return (
    <form action={action} className="product-form card" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {err ? (
        <div className="banner-error" role="alert">
          <span>{err}</span>
        </div>
      ) : null}
      <CodeField id="mfa-enrol-code" label={labels.code} />
      <div className="actions">
        <SubmitButton label={labels.submit} pendingLabel={labels.pending} className="btn primary" />
      </div>
    </form>
  );
}

function RegenerateCodesForm({
  locale,
  state,
  action,
  labels,
}: {
  locale: string;
  state: MfaFormState;
  action: (formData: FormData) => void;
  labels: { code: string; submit: string; pending: string; errors: ErrorLabels };
}) {
  const err = errorText(state, labels.errors);
  return (
    <form action={action} className="product-form card" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {err ? (
        <div className="banner-error" role="alert">
          <span>{err}</span>
        </div>
      ) : null}
      <CodeField id="mfa-regen-code" label={labels.code} />
      <div className="actions">
        <SubmitButton label={labels.submit} pendingLabel={labels.pending} className="btn secondary" />
      </div>
    </form>
  );
}

function DisableMfaForm({
  locale,
  hasPassword,
  labels,
}: {
  locale: string;
  hasPassword: boolean;
  labels: {
    password: string;
    code: string;
    codeHint: string;
    submit: string;
    pending: string;
    errors: ErrorLabels;
  };
}) {
  const [state, action] = useActionState(disableMfaAction, {});
  const err = errorText(state, labels.errors);
  return (
    <form action={action} className="product-form card" noValidate>
      <input type="hidden" name="locale" value={locale} />
      {err ? (
        <div className="banner-error" role="alert">
          <span>{err}</span>
        </div>
      ) : null}
      {hasPassword ? (
        <div className="field">
          <label htmlFor="mfa-disable-password">{labels.password}</label>
          <input
            id="mfa-disable-password"
            name="password"
            type="password"
            autoComplete="current-password"
          />
        </div>
      ) : null}
      <CodeField id="mfa-disable-code" label={labels.code} hint={hasPassword ? labels.codeHint : undefined} />
      <div className="actions">
        <SubmitButton label={labels.submit} pendingLabel={labels.pending} className="btn danger" />
      </div>
    </form>
  );
}

export type MfaPanelLabels = {
  code: string;
  codeOrRecovery: string;
  password: string;
  working: string;
  errors: ErrorLabels;
  recoveryTitle: string;
  recoveryLead: string;
  recoveryDone: string;
  statusEyebrow: string;
  statusOn: string;
  statusOff: string;
  enabledSince: string | null;
  recoveryLeft: string;
  recoveryEyebrow: string;
  regenerateTitle: string;
  regenerateLead: string;
  regenerate: string;
  disableEyebrow: string;
  disableTitle: string;
  disableLead: string;
  disableCodeHint: string;
  disable: string;
  setupTitle: string;
  step1: string;
  step2: string;
  step3: string;
  setupKey: string;
  openInApp: string;
  confirm: string;
  cancelSetup: string;
  offBody: string;
  setupButton: string;
};

// Two-factor settings surface: recovery codes (when just issued), else the
// enabled / setting-up / off state.
export function MfaPanel({
  locale,
  enabled,
  setup,
  hasPassword,
  doneHref,
  freshCodes,
  startAction,
  cancelAction,
  dismissAction,
  labels,
}: {
  locale: string;
  enabled: boolean;
  /** Present while a secret is waiting for its first code. */
  setup: { secretGrouped: string; otpauthUri: string } | null;
  hasPassword: boolean;
  doneHref: string;
  /** Recovery codes generated a moment ago, to be shown exactly once. */
  freshCodes: string[] | null;
  dismissAction: (formData: FormData) => void | Promise<void>;
  startAction: (formData: FormData) => void | Promise<void>;
  cancelAction: (formData: FormData) => void | Promise<void>;
  labels: MfaPanelLabels;
}) {
  const [confirmState, confirmAction] = useActionState(confirmMfaEnrolment, {});
  const [regenState, regenAction] = useActionState(regenerateMfaRecoveryCodes, {});

  if (freshCodes) {
    return (
      <section className="section" id="recovery-codes">
        <RecoveryCodes
          codes={freshCodes}
          title={labels.recoveryTitle}
          lead={labels.recoveryLead}
          doneLabel={labels.recoveryDone}
          pendingLabel={labels.working}
          locale={locale}
          doneHref={doneHref}
          dismissAction={dismissAction}
        />
      </section>
    );
  }

  if (enabled) {
    return (
      <>
        <section className="section" id="status">
          <div className="section-head">
            <div>
              <span className="eyebrow">{labels.statusEyebrow}</span>
              <h2>{labels.statusOn}</h2>
            </div>
          </div>
          <div className="product-form card">
            {labels.enabledSince ? <p>{labels.enabledSince}</p> : null}
            <p className="muted small">{labels.recoveryLeft}</p>
          </div>
        </section>

        <section className="section" id="recovery">
          <div className="section-head">
            <div>
              <span className="eyebrow">{labels.recoveryEyebrow}</span>
              <h2>{labels.regenerateTitle}</h2>
              <p className="muted small">{labels.regenerateLead}</p>
            </div>
          </div>
          <RegenerateCodesForm
            locale={locale}
            state={regenState}
            action={regenAction}
            labels={{
              code: labels.code,
              submit: labels.regenerate,
              pending: labels.working,
              errors: labels.errors,
            }}
          />
        </section>

        <section className="section" id="disable">
          <div className="section-head">
            <div>
              <span className="eyebrow">{labels.disableEyebrow}</span>
              <h2>{labels.disableTitle}</h2>
              <p className="muted small">{labels.disableLead}</p>
            </div>
          </div>
          <DisableMfaForm
            locale={locale}
            hasPassword={hasPassword}
            labels={{
              password: labels.password,
              code: labels.codeOrRecovery,
              codeHint: labels.disableCodeHint,
              submit: labels.disable,
              pending: labels.working,
              errors: labels.errors,
            }}
          />
        </section>
      </>
    );
  }

  if (setup) {
    return (
      <section className="section" id="setup">
        <div className="section-head">
          <div>
            <span className="eyebrow">{labels.statusEyebrow}</span>
            <h2>{labels.setupTitle}</h2>
          </div>
        </div>
        <div className="product-form card">
          <ol>
            <li>{labels.step1}</li>
            <li>
              {labels.step2}
              <div className="field" style={{ marginTop: 8 }}>
                <label htmlFor="mfa-setup-key">{labels.setupKey}</label>
                <input id="mfa-setup-key" readOnly value={setup.secretGrouped} style={MONO} />
                <span className="hint">
                  <a href={setup.otpauthUri}>{labels.openInApp}</a>
                </span>
              </div>
            </li>
            <li>{labels.step3}</li>
          </ol>
        </div>
        <ConfirmEnrolmentForm
          locale={locale}
          state={confirmState}
          action={confirmAction}
          labels={{
            code: labels.code,
            submit: labels.confirm,
            pending: labels.working,
            errors: labels.errors,
          }}
        />
        <form action={cancelAction} style={{ marginTop: 12 }}>
          <input type="hidden" name="locale" value={locale} />
          <SubmitButton
            label={labels.cancelSetup}
            pendingLabel={labels.working}
            className="btn secondary small"
          />
        </form>
      </section>
    );
  }

  return (
    <section className="section" id="status">
      <div className="section-head">
        <div>
          <span className="eyebrow">{labels.statusEyebrow}</span>
          <h2>{labels.statusOff}</h2>
        </div>
      </div>
      <form action={startAction} className="product-form card">
        <input type="hidden" name="locale" value={locale} />
        <p>{labels.offBody}</p>
        <div className="actions">
          <SubmitButton label={labels.setupButton} pendingLabel={labels.working} className="btn primary" />
        </div>
      </form>
    </section>
  );
}
