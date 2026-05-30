export type TeamMember = {
  name: string;
  role: string;
  /** Path under /public, e.g. "/team/jane.jpg". Omit for an initials avatar. */
  photo?: string;
  linkedin?: string;
  phone?: string;
};

// Populate with the real desk team. Empty array → TeamRow renders nothing,
// so the contact page is unchanged until real people/photos are supplied.
export const DESK_TEAM: TeamMember[] = [];
