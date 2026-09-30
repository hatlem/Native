"use client";

import { useState } from "react";
import type { MembershipRole } from "@/lib/membership";

type Labels = {
  roleAdmin: string;
  roleMember: string;
  roleRestricted: string;
  canCommit: string;
  adminNote: string;
  restrictedNote: string;
};

// The role picker and the ordering-rights ("can commit") box, kept in step as
// the role changes: an administrator always has ordering rights and a
// view-only (Restricted) seat never does (lib/membership commitGrantFor), so
// for those two roles the box is shown locked in the state the server will
// store instead of as a choice it would silently override. Only a member's
// box is a real choice, and it is remembered across role switches.
//
// A disabled checkbox isn't submitted — fine, because the server derives the
// locked values from the role alone.
export function RoleCommitFields({
  variant,
  defaultRole,
  defaultCanCommit,
  labels,
  roleSelectId,
  roleLabel,
}: {
  // "stacked": the invite form's labelled fields. "inline": one row in the
  // members table.
  variant: "stacked" | "inline";
  defaultRole: MembershipRole;
  defaultCanCommit: boolean;
  labels: Labels;
  roleSelectId?: string;
  roleLabel?: string;
}) {
  const [role, setRole] = useState<MembershipRole>(defaultRole);
  const [memberCommit, setMemberCommit] = useState(defaultRole === "MEMBER" && defaultCanCommit);
  const locked = role !== "MEMBER";
  const checked = role === "ADMIN" ? true : role === "RESTRICTED" ? false : memberCommit;
  const note = role === "ADMIN" ? labels.adminNote : role === "RESTRICTED" ? labels.restrictedNote : null;

  const select = (
    <select
      id={roleSelectId}
      name="role"
      value={role}
      onChange={(e) => setRole(e.target.value as MembershipRole)}
    >
      <option value="ADMIN">{labels.roleAdmin}</option>
      <option value="MEMBER">{labels.roleMember}</option>
      <option value="RESTRICTED">{labels.roleRestricted}</option>
    </select>
  );
  const checkbox = (
    <label className="checkbox-label" title={labels.canCommit}>
      <input
        type="checkbox"
        name="canCommit"
        checked={checked}
        disabled={locked}
        onChange={(e) => setMemberCommit(e.target.checked)}
      />
      {labels.canCommit}
    </label>
  );

  if (variant === "inline") {
    return (
      <>
        {select}
        {checkbox}
        {note ? <span className="hint">{note}</span> : null}
      </>
    );
  }

  return (
    <>
      <div className="field">
        {roleLabel ? <label htmlFor={roleSelectId}>{roleLabel}</label> : null}
        {select}
      </div>
      <div className="field">
        {checkbox}
        {/* Said for the role picked, not both rules at once. */}
        {note ? <span className="hint">{note}</span> : null}
      </div>
    </>
  );
}
