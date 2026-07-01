// Shared design-system components — typed wrappers over the CSS classes
// in globals.css. Prefer these over inlining the class names so we can
// evolve the markup in one place.

export { PageHeader } from "./page-header";
export { Breadcrumb } from "./breadcrumb";
export { SectionHead } from "./section-head";
export { Kpi, KpiGrid } from "./kpi";
export { ActionList, ActionListItem } from "./action-list";
export { DetailHead, MetaRow } from "./detail-head";
export { QuoteCard } from "./quote-card";
export { SubmitButton } from "./submit-button";
export { MailLink } from "./mail-link";
export { SafeEmail, withSafeEmails } from "./safe-email";
export { GetTalkBooking, resolveBookingFallbackHref } from "./get-talk-booking";
