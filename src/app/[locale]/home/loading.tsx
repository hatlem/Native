import { AppSkeleton } from "@/app/app-skeleton";

// Home aggregates quotes, drafts, orders and programme waves; show the page
// shape while that runs. Safe here (see app-skeleton.tsx): home is a leaf,
// never 404s, and signed-out visitors are redirected by middleware before it
// renders. Its one in-page redirect — a staff account opening /home — only
// becomes a client-side hop.
export default function Loading() {
  return <AppSkeleton />;
}
